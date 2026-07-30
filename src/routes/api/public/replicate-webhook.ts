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
            const { failMediaJob } = await import("@/lib/media-finalize.server");
            await failMediaJob(job, "No output URL received from generation model");
            return new Response("Failed status processed", { status: 200 });
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
            const { completeMediaJob } = await import("@/lib/media-finalize.server");
            await completeMediaJob(job, outputUrl);
            return new Response("Success", { status: 200 });
          } catch (e: any) {
            const { failMediaJob } = await import("@/lib/media-finalize.server");
            await failMediaJob(job, `Storage upload failed: ${e.message}`);
            return new Response("Failed status processed", { status: 200 });
          }
        }

        if (status === "failed" || status === "canceled") {
          const { failMediaJob } = await import("@/lib/media-finalize.server");
          await failMediaJob(job, body.error || `Prediction ended with status: ${status}`);
          return new Response("Failed status processed", { status: 200 });
        }

        return new Response("Unknown status", { status: 200 });
      },
    },
  },
});
