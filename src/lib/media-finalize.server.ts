// Shared finalize logic for async media jobs, used by BOTH the Replicate webhook
// (fast path) and the client-driven reconcile poll (checkMediaJob, reliable path).
// Completion must not depend on the webhook landing, so this lives in one place.

import { supabaseAdmin } from "@/integrations/supabase/client.server";

type Job = {
  id: string;
  user_id: string;
  conversation_id: string | null;
  kind: string;
  cost: number;
};

// Download a finished Replicate output, store it in the avatars bucket, mark the
// job completed, and post the media message. Throws on storage failure so the
// caller can mark the job failed + refund.
export async function completeMediaJob(job: Job, outputUrl: string): Promise<string> {
  const response = await fetch(outputUrl);
  if (!response.ok) throw new Error("Could not fetch generation output");
  const buf = Buffer.from(await response.arrayBuffer());

  // Derive the type from what actually came back, not from job.kind. A photo is
  // currently rendered on the image-to-video endpoint (the only uncensored model
  // available), so an "image" job legitimately produces an mp4 whose end frame is
  // the still — storing that as .png served a video with the wrong content type
  // and nothing would display it.
  const looksVideo =
    /video\//i.test(response.headers.get("content-type") ?? "") ||
    /\.(mp4|webm|mov)(\?|$)/i.test(outputUrl);
  const fileExt = looksVideo ? "mp4" : "png";
  const mimeType = looksVideo ? "video/mp4" : "image/png";
  const path = `generated/${job.user_id}/${job.id}.${fileExt}`;

  try {
    await supabaseAdmin.storage.createBucket("avatars", { public: true });
  } catch {
    /* already exists */
  }

  const { error: upErr } = await supabaseAdmin.storage
    .from("avatars")
    .upload(path, buf, { contentType: mimeType, upsert: true });
  if (upErr) throw upErr;

  const { data: pub } = supabaseAdmin.storage.from("avatars").getPublicUrl(path);
  const mediaUrl = pub.publicUrl;

  // Only flip processing -> completed once; if another path already completed
  // it, skip the duplicate chat message.
  const { data: claimed } = await supabaseAdmin
    .from("media_jobs")
    .update({ status: "completed", media_url: mediaUrl, updated_at: new Date().toISOString() })
    .eq("id", job.id)
    .neq("status", "completed")
    .select("id")
    .maybeSingle();

  if (claimed && job.conversation_id) {
    await supabaseAdmin.from("messages").insert({
      conversation_id: job.conversation_id,
      user_id: job.user_id,
      role: "assistant",
      content: job.kind === "video" ? "*sends you a video* 🎬" : "*sends you a photo* 😈",
      kind: job.kind,
      media_url: mediaUrl,
    });
  }

  return mediaUrl;
}

// Mark a job failed and refund its cost. Idempotent: the ledger's unique
// idempotency_key guards against a double refund if both the webhook and the
// poll try to fail the same job.
export async function failMediaJob(job: Job, errorMsg: string): Promise<void> {
  await supabaseAdmin
    .from("media_jobs")
    .update({ status: "failed", error: errorMsg, updated_at: new Date().toISOString() })
    .eq("id", job.id);

  try {
    const { data: bal } = await supabaseAdmin
      .from("credit_balances")
      .select("free_messages_remaining, paid_credits")
      .eq("user_id", job.user_id)
      .maybeSingle();
    const free = bal?.free_messages_remaining ?? 0;
    const paid = bal?.paid_credits ?? 0;
    const newPaid = paid + job.cost;

    // Ledger first — the unique key makes this the refund's lock. If it conflicts,
    // someone already refunded this job, so don't touch the balance again.
    const { error: ledgerErr } = await supabaseAdmin.from("credit_ledger").insert({
      user_id: job.user_id,
      delta: job.cost,
      reason: "refund_credit",
      balance_after: free + newPaid,
      idempotency_key: `refund-${job.id}`,
    });
    if (ledgerErr) return;

    await supabaseAdmin
      .from("credit_balances")
      .update({ paid_credits: newPaid })
      .eq("user_id", job.user_id);

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
    console.error("Refund failed in media finalize", e);
  }
}
