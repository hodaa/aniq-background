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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function safeEndpoint(url: string): string {
  const parsed = new URL(url);
  return `${parsed.origin}${parsed.pathname}`;
}

async function runJob(job: JobName, env: Env): Promise<void> {
  const url = new URL(JOBS[job], env.BACKEND_URL).toString();
  const endpoint = safeEndpoint(url);
  console.log(JSON.stringify({ event: "cron.job.started", job, endpoint }));

  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${env.CRON_SECRET}`,
        Accept: "application/json"
      }
    });
  } catch (error) {
    const message = errorMessage(error);
    console.error(JSON.stringify({ event: "cron.job.network_error", job, endpoint, message }));
    throw new Error(`${job} network request failed: ${message}`);
  }

  if (!response.ok) {
    const responseBody = (await response.text()).slice(0, 500);
    console.error(JSON.stringify({
      event: "cron.job.http_error",
      job,
      endpoint,
      status: response.status,
      responseBody
    }));
    throw new Error(`${job} failed with HTTP ${response.status}`);
  }

  console.log(JSON.stringify({ event: "cron.job.succeeded", job, endpoint, status: response.status }));
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

    for (const [index, result] of results.entries()) {
      if (result.status === "rejected") {
        console.error(JSON.stringify({
          event: "cron.job.failed",
          job: jobs[index],
          message: errorMessage(result.reason)
        }));
      }
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
