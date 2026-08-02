import { ensureEmbeddedRssHubReady } from '@/server/integrations/rsshub/embeddedRssHubApp';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Embedded RSSHub is not ready';
}

export async function GET() {
  try {
    await ensureEmbeddedRssHubReady();
    return Response.json({
      ok: true,
      data: {
        available: true,
        mode: 'embedded',
      },
    });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        data: {
          available: false,
          mode: 'embedded',
        },
        error: {
          code: 'rsshub_unavailable',
          message: getErrorMessage(error),
        },
      },
      { status: 503 },
    );
  }
}
