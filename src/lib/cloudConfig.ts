/**
 * 云服务 publicConfig
 *
 * 由「开通云服务」时签发，是**唯一**允许进入前端产物的云配置。
 * 这四个字段本身不携带权限：`publishableKey` 只标识「哪个应用」，
 * 真正的鉴权由服务端按 Origin 精确匹配完成，所以它们可以打包进前端。
 *
 * ⚠️ 不要在本文件之外再写任何 endpoint 字面量，也不要从 window.location /
 *    环境变量 / 后端接口去推导 endpoint —— 唯一来源就是这里。
 * ⚠️ 如果应用换了发布域名，endpoint 会失效（服务端 Origin 匹配不上），
 *    此时需要重新开通/发布，并把新签发的值更新到这里。
 */
export const CLOUD_PUBLIC_CONFIG = {
  /** 云服务资源 id */
  resourceId: 'wbcs_YGnbAp8MgZRBortzhHHx6f',
  /** 本应用发布域名的数据面基址，`/.cloud/**` 挂在它下面 */
  endpoint: 'https://heartlog-diary.app.workbuddy.host',
  /** OAuth Relay 中心基址（网页第三方登录用，与 endpoint 不是同一条入口） */
  oauthRelayBaseUrl: 'https://www.workbuddy.cn/v2/as/genie-baas/oauth',
  /** 半公开的应用标识 key */
  publishableKey: 'wbpk_BnndpgNagbBk6CDMuYbLXs_AgZxGbhl3EoQShZFcWe2pwqC2kcoSiuF',
} as const

/** 云端对象存储里的路径前缀（相对用户目录） */
export const CLOUD_ROOT = 'heartlog'
