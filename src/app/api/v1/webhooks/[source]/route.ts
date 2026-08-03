import { isValidWebhookSignature } from "@/lib/api/webhook-signature";
import { createServiceClient } from "@/lib/supabase/service";

export async function POST(
  request: Request,
  context: { params: Promise<{ source: string }> }
) {
  const { source } = await context.params;
  const rawBody = await request.text();
  const signatureHeader = request.headers.get("x-webhook-signature");
  const secret = process.env.WEBHOOK_SHARED_SECRET ?? "";

  const signatureValid = isValidWebhookSignature(rawBody, signatureHeader, secret);

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return Response.json({ error: "Invalid JSON payload." }, { status: 400 });
  }

  const supabase = createServiceClient();
  await supabase.from("webhook_events").insert({
    source,
    payload: payload as never,
    signature_valid: signatureValid,
  });

  if (!signatureValid) {
    return Response.json({ error: "Invalid signature." }, { status: 401 });
  }

  return Response.json({ status: "received" });
}
