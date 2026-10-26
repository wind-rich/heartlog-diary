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
/**
 * 2026-10-25 切换说明：
 * 旧配置指向旧站点应用 heartlog-diary（resourceId wbcs_YGnbAp8MgZRBortzhHHx6f）。
 * 用户确认旧云备份通道不再需要，作者数据改为多端共用，故切换到当前展示站所属应用
 * （与公开发布同域，登录 Origin 才能匹配）。
 * 切换后旧云端里的备份不再可读；本地完整 ZIP 备份与 T0 证据不受影响。
 */
export const CLOUD_PUBLIC_CONFIG = {
  /** 云服务资源 id */
  resourceId: 'wbcs_1lyRSi9FZh1HDkYpzXm8zj',
  /** 本应用发布域名的数据面基址，`/.cloud/**` 挂在它下面 */
  endpoint: 'https://heartlog-viewer.app.workbuddy.host',
  /** OAuth Relay 中心基址（网页第三方登录用，与 endpoint 不是同一条入口） */
  oauthRelayBaseUrl: 'https://www.workbuddy.cn/v2/as/genie-baas/oauth',
  /** 半公开的应用标识 key */
  publishableKey: 'wbpk_vbUENOY2x9PfxFaOehR1QH_qBN7EuOLR0hCd3zBFdgnPWUeX28LlaFd',
} as const

/** 云端对象存储里的路径前缀（相对用户目录） */
export const CLOUD_ROOT = 'heartlog'
