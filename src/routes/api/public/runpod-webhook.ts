import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

// RunPod webhook receiver for async image/video generation.
// URL: https://<your-domain>/api/public/runpod-webhook
//
// RunPod only calls back on a TERMINAL state, and the callback body is the same
// payload as GET /status/{id}. This is the fast path — it delivers the media (or
// the refund) even when the user has closed the tab; checkMediaJob's poll is the
// authoritative one and reconciles anything the webhook misses.
export const Route = createFileRoute("/api/public/runpod-webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: any;
        try {
          body = await request.json();
        } catch {
          return new Response("Bad JSON", { status: 400 });
        }

        const jobId = body.id;
        if (!jobId) return new Response("Missing id", { status: 400 });

        const { data: job } = await supabaseAdmin
          .from("media_jobs")
          .select("id, user_id, conversation_id, kind, cost, status")
          .eq("replicate_id", jobId)
          .maybeSingle();

        // 200 on every outcome below so RunPod doesn't retry a callback we've
        // already handled (or can't match to a job).
        if (!job) return new Response("Job not found", { status: 200 });
        if (job.status === "completed" || job.status === "failed") {
          return new Response("Already finished", { status: 200 });
        }

        const { runpodStatusOf, runpodOutputUrl, runpodOutputError } = await import("@/lib/runpod");
        const { completeMediaJob, failMediaJob } = await import("@/lib/media-finalize.server");
        const state = runpodStatusOf(body.status);

        if (state === "processing") {
          await supabaseAdmin
            .from("media_jobs")
            .update({ status: "processing", updated_at: new Date().toISOString() })
            .eq("id", job.id);
          return new Response("Processing", { status: 200 });
        }

        const err = runpodOutputError(body.output, body.error);
        if (state === "failed" || err) {
          await failMediaJob(job, err || `Job ended with status: ${body.status}`);
          return new Response("Failed status processed", { status: 200 });
        }

        const url = runpodOutputUrl(body.output);
        if (!url) {
          await failMediaJob(job, "No output URL received from generation model");
          return new Response("Failed status processed", { status: 200 });
        }

        try {
          await completeMediaJob(job, url);
          return new Response("Success", { status: 200 });
        } catch (e: any) {
          await failMediaJob(job, `Storage upload failed: ${e.message}`);
          return new Response("Failed status processed", { status: 200 });
        }
      },
    },
  },
});
