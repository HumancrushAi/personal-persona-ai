import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

// Replicate webhook receiver for async image/video generation.
// URL: https://<your-domain>/api/public/replicate-webhook
export const Route = createFileRoute("/api/public/replicate-webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: any;
        try {
          body = await request.json();
        } catch {
          return new Response("Bad JSON", { status: 400 });
        }

        const replicateId = body.id;
        if (!replicateId) return new Response("Missing id", { status: 400 });

        // Query the job
        const { data: job, error: jobErr } = await supabaseAdmin
          .from("media_jobs")
          .select("id, user_id, conversation_id, kind, cost, status")
          .eq("replicate_id", replicateId)
          .maybeSingle();

        if (jobErr || !job) {
          return new Response("Job not found", { status: 200 }); // Return 200 so Replicate doesn't retry
        }

        // If the job is already finished, ignore duplicate webhook events
        if (job.status === "completed" || job.status === "failed") {
          return new Response("Already finished", { status: 200 });
        }

        const status = body.status;

        if (status === "starting" || status === "processing") {
          await supabaseAdmin
            .from("media_jobs")
            .update({ status: "processing", updated_at: new Date().toISOString() })
            .eq("id", job.id);
          return new Response("Processing", { status: 200 });
        }

        if (status === "succeeded") {
          const rawOutput = body.output;
          let outputUrl = Array.isArray(rawOutput) ? rawOutput[0] : rawOutput;

          if (!outputUrl) {
            // Treat as failed if output is missing
            return await handleFailure(job, "No output URL received from generation model");
          }

          // If this was the initial image generation (not face swap) AND a face URL is configured,
          // trigger the face swap model asynchronously.
          const { FACE_SWAP_VERSION } = await import("@/lib/ai");
          const isFaceSwap = body.version === FACE_SWAP_VERSION;
          if (job.kind === "image" && !isFaceSwap && job.conversation_id) {
            try {
              const { data: conv } = await supabaseAdmin
                .from("conversations")
                .select("user_personalities(companions(image_url))")
                .eq("id", job.conversation_id)
                .maybeSingle();

              const faceUrl = (conv as any)?.user_personalities?.companions?.image_url;
              if (faceUrl && /^(https?:|data:)/.test(faceUrl)) {
                const { triggerReplicate } = await import("@/lib/ai");
                const swapPrediction = await triggerReplicate(
                  FACE_SWAP_VERSION,
                  { swap_image: faceUrl, input_image: outputUrl },
                  request.url
                );

                // Update job record with the new replicate_id so we track this swap prediction instead
                await supabaseAdmin
                  .from("media_jobs")
                  .update({
                    replicate_id: swapPrediction.id,
                    updated_at: new Date().toISOString()
                  })
                  .eq("id", job.id);

                return new Response("Triggered face swap", { status: 200 });
              }
            } catch (err: any) {
              console.error("Face swap chaining failed, falling back to unswapped image", err);
            }
          }

          try {
            // Securely store the completed media in Supabase Storage avatars bucket
            const response = await fetch(outputUrl);
            if (!response.ok) throw new Error("Could not fetch Replicate output image");
            const buf = Buffer.from(await response.arrayBuffer());

            const fileExt = job.kind === "video" ? "mp4" : "png";
            const mimeType = job.kind === "video" ? "video/mp4" : "image/png";
            const path = `generated/${job.user_id}/${job.id}.${fileExt}`;

            // Ensure bucket exists
            try {
              await supabaseAdmin.storage.createBucket("avatars", { public: true });
            } catch {
              /* ignore */
            }

            const { error: upErr } = await supabaseAdmin.storage
              .from("avatars")
              .upload(path, buf, { contentType: mimeType, upsert: true });

            if (upErr) throw upErr;

            const { data: pub } = supabaseAdmin.storage.from("avatars").getPublicUrl(path);
            const mediaUrl = pub.publicUrl;

            // Update Job Status
            await supabaseAdmin
              .from("media_jobs")
              .update({
                status: "completed",
                media_url: mediaUrl,
                updated_at: new Date().toISOString(),
              })
              .eq("id", job.id);

            // Append completed message to conversation history
            if (job.conversation_id) {
              const messageContent =
                job.kind === "video"
                  ? "*sends you a video* 🎬"
                  : "*sends you a photo* 😈";
              await supabaseAdmin.from("messages").insert({
                conversation_id: job.conversation_id,
                user_id: job.user_id,
                role: "assistant",
                content: messageContent,
                kind: job.kind,
                media_url: mediaUrl,
              });
            }

            return new Response("Success", { status: 200 });
          } catch (e: any) {
            return await handleFailure(job, `Storage upload failed: ${e.message}`);
          }
        }

        if (status === "failed" || status === "canceled") {
          return await handleFailure(job, body.error || `Prediction ended with status: ${status}`);
        }

        return new Response("Unknown status", { status: 200 });
      },
    },
  },
});

async function handleFailure(job: any, errorMsg: string) {
  // Update job record
  await supabaseAdmin
    .from("media_jobs")
    .update({
      status: "failed",
      error: errorMsg,
      updated_at: new Date().toISOString(),
    })
    .eq("id", job.id);

  // Refund credits to user's wallet
  try {
    const { data: bal } = await supabaseAdmin
      .from("credit_balances")
      .select("free_messages_remaining, paid_credits")
      .eq("user_id", job.user_id)
      .maybeSingle();

    const free = bal?.free_messages_remaining ?? 0;
    const paid = bal?.paid_credits ?? 0;
    const newPaid = paid + job.cost;

    await supabaseAdmin
      .from("credit_balances")
      .update({ paid_credits: newPaid })
      .eq("user_id", job.user_id);

    // Write to ledger
    await supabaseAdmin.from("credit_ledger").insert({
      user_id: job.user_id,
      delta: job.cost,
      reason: "refund_credit",
      balance_after: free + newPaid,
      idempotency_key: `refund-${job.id}`,
    });

    // Notify user in chat
    if (job.conversation_id) {
      const kindStr = job.kind === "video" ? "video" : "photo";
      await supabaseAdmin.from("messages").insert({
        conversation_id: job.conversation_id,
        user_id: job.user_id,
        role: "assistant",
        content: `Sorry, I had trouble generating that ${kindStr}. Your credits have been refunded! 🥺❤️`,
        kind: "text",
      });
    }
  } catch (e: any) {
    console.error("Refund failed in webhook callback", e);
  }

  return new Response("Failed status processed", { status: 200 });
}
