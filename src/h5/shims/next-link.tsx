/**
 * next/link 的 H5 shim：渲染 <a href="#/path">，行为与 SPA hash 路由一致。
 * 仅覆盖 feature 组件用到的用法（href + 常规 props），不支持 prefetch 等 Next 特性。
 */
import { forwardRef, type AnchorHTMLAttributes, type ReactNode } from 'react';
import { toHashHref } from '../lib/router';

interface LinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  href: string;
  children?: ReactNode;
}

const Link = forwardRef<HTMLAnchorElement, LinkProps>(function Link({ href, ...rest }, ref) {
  return <a ref={ref} href={toHashHref(href)} {...rest} />;
});

export default Link;
