# R4 Android 请求摘要逻辑留存摘录（2026-10-27）

这份摘录回应 Dot 对固定差量 `dcdd6fdb` 的复核意见。只收录生成两种前缀所需的现有代码片段，不含 token、密钥值、Authorization、Cookie、手机号或用户 ID；不重跑请求或验证流程。

本机留存的代理源文件：`/tmp/qf-r4-android-runtime/proxy.mjs`
该源文件当前 SHA-256：`d329a822cf6d5b10c9a789f79f35dcf5ce1c9630a368d2398adc8563ba345d42`

```js
function logClaim(token,response,status,requestId,at){
  const visitorId=security.promotionVisitorId(token);
  const record={
    requestId,at,method:'POST',path:'/promotions/attribution/claim',
    tokenSha256Prefix:createHash('sha256').update(token).digest('hex').slice(0,16),
    visitorKeyHashPrefix:visitorId?security.promotionVisitorHash(visitorId).toString('hex').slice(0,16):null,
    httpStatus:status,claimed:response?.claimed===true,reason:response?.reason??null
  };
}
```

`createHash('sha256').update(token)` 使用 Node.js 默认 UTF-8 字符串编码；结果取小写十六进制前 16 位。visitor 前缀调用仓库 `server/src/security.js` 的 `promotionVisitorHash(visitorId)`；该函数以运行时传入的 `PHONE_HASH_KEY_HEX` 派生 HMAC 密钥，对 `promotion-key:${visitorId}` 计算 HMAC-SHA-256，转小写十六进制后取前 16 位。token 中的 visitor ID 先由同一 security 模块验证 `promotion-visitor:${visitorId}` 签名。

本摘录让复核者能检查当时记录代码的算法和截断方式；由于原始 token 与密钥不留存，无法也不应重算两条具体请求的摘要。代码摘录与同目录日志的来源关系基于本机留存路径和执行记录，未声称有独立的进程级源码校验日志。
