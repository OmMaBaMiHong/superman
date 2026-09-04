import { NextRequest, NextResponse } from 'next/server';

const SESSION_COOKIE_NAME = 'feedfuse_session';
const PUBLIC_PATHS = [
  '/api/health',
  '/api/auth/login',
  '/api/auth/register',
  '/api/auth/setup',
  '/api/video/serve',
  '/api/video/material',
  '/api/video/material-data',
  '/api/video/download',
  '/api/video/transcript',
  // OpenChatCut 去剪辑需要免鉴权拉取工作区素材（仅本地开发用）
  '/api/workspace/serve',
  '/api/workspace/material-data',
];

function isPublicApiPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + '/'));
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // 仅保护 /api/ 路由
  if (!pathname.startsWith('/api/')) {
    return NextResponse.next();
  }

  // 公开路由放行
  if (isPublicApiPath(pathname)) {
    return NextResponse.next();
  }

  // 测试环境放行
  if (process.env.NODE_ENV === 'test' || process.env.VITEST === 'true') {
    return NextResponse.next();
  }

  const sessionToken = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!sessionToken) {
    return NextResponse.json(
      { ok: false, error: { code: 'unauthorized', message: '请先登录后再继续' } },
      { status: 401 },
    );
  }

  // middleware 中无法访问数据库，仅做基础 token 格式校验
  // 完整的 session 验证仍由各 route handler 中的 requireApiSession 完成
  const [payloadPart, signaturePart] = sessionToken.split('.');
  if (!payloadPart || !signaturePart) {
    return NextResponse.json(
      { ok: false, error: { code: 'unauthorized', message: '请先登录后再继续' } },
      { status: 401 },
    );
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/api/:path*'],
};
