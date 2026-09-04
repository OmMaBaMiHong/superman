/**
 * 四家适配器共用的小工具。
 * 只放**无平台语义**的纯函数；任何平台差异都必须留在各自的适配器文件里。
 */

/** 从任意 JSON 值里安全取字符串字段，非字符串或空串一律返回 null。 */
export function readString(raw: unknown, key: string): string | null {
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const value = (raw as Record<string, unknown>)[key];
  if (typeof value === 'string' && value.trim() !== '') {
    return value;
  }
  // 部分平台会把数值型 id 直接给成 number（GitHub 的 user.id 即是）。
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

/** 从任意 JSON 值里安全取有限数字字段。 */
export function readNumber(raw: unknown, key: string): number | null {
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const value = (raw as Record<string, unknown>)[key];
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/** 取嵌套对象（抖音的 `{ data: {...} }` 结构）。 */
export function readObject(raw: unknown, key: string): unknown {
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  return (raw as Record<string, unknown>)[key] ?? null;
}

/** 拼接 scope。四家均以空格分隔，微信/抖音实际只用单 scope。 */
export function joinScopes(scopes: string[], separator = ' '): string {
  return scopes.filter((scope) => scope.trim() !== '').join(separator);
}
