export interface Env {
  BACKEND_URL: string;
  CRON_SECRET: string;
}

type JobName =
  | "paymob-reconciliation"
  | "shipping-compensation"
  | "expired-confirmation-release"
  | "order-cancellation"
  | "product-review"
  | "expired-payment-reservations";

const JOBS: Record<JobName, string> = {
  "paymob-reconciliation": "/api/v1/internal/cron/paymob-reconciliation",
  "shipping-compensation": "/api/v1/internal/cron/shipping-compensation",
  "expired-confirmation-release": "/api/v1/internal/cron/expired-confirmation-release",
  "order-cancellation": "/api/v1/internal/cron/order-cancellation",
  "product-review": "/api/v1/internal/cron/product-review",
  "expired-payment-reservations":"/api/v1/internal/cron/expired-payment-reservations"
};

function jobsForCron(cron: string): JobName[] {
  switch (cron) {
    case "*/5 * * * *":
      return ["paymob-reconciliation", "shipping-compensation", "product-review", "expired-payment-reservations"];
    case "*/15 * * * *":
      return ["expired-confirmation-release"];
    case "0 0 * * *":
      return ["order-cancellation"];
    default:
      return [];
  }
}

async function runJob(job: JobName, env: Env): Promise<void> {
  const url = new URL(JOBS[job], env.BACKEND_URL).toString();
  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${env.CRON_SECRET}`,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${job} failed with ${response.status}: ${body.slice(0, 500)}`);
  }

  console.log(JSON.stringify({ job, status: response.status, ok: true }));
}

export default {
  async scheduled(
    controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<void> {
    const jobs = jobsForCron(controller.cron);

    if (jobs.length === 0) {
      console.warn(`No jobs configured for cron expression: ${controller.cron}`);
      return;
    }

    // Run selected jobs independently so one failure does not hide the others.
    const results = await Promise.allSettled(jobs.map((job) => runJob(job, env)));
    const failures = results.filter(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );

    for (const failure of failures) {
      console.error(failure.reason);
    }

    if (failures.length > 0) {
      // Throwing makes the scheduled invocation visible as failed in Workers logs.
      throw new Error(`${failures.length} of ${jobs.length} cron jobs failed`);
    }
  },

  async fetch(request: Request): Promise<Response> {
    if (request.method !== "GET") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    return new Response("ANIQ cron worker is running", { status: 200 });
  },
};
