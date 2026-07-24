# Changelog

所有重要變更會記錄於此。

## [Unreleased] - 2026-07-24

### Added

- TTS 短效簽章 token、允許來源設定與 Neon 分散式用量限制。
- `POST /api/tts-token`，供 widget 取得短效 TTS token。
- 每日資料保存期限清除：Vercel Cron、`/api/cron/retention`、清除服務與資料庫 migration。
- GitHub Actions CI：鎖定依賴安裝、測試與 production dependency audit。
- Playwright E2E 基礎設定與後台、iframe 通訊測試案例。
- URL 匯入、TTS 安全與資料清除的回歸測試。

### Changed

- 網址匯入改為只連線到已驗證的 DNS 位址，避免 DNS rebinding 造成 SSRF。
- 移除分析、客服、名單與稽核紀錄的機率式清除，改由固定排程處理。
- Widget 呼叫 TTS 前會先取得短效 token。
- `axios` 更新至 `1.18.1`，修復既有相依性安全警示。

### Configuration

- 正式環境需設定 `TTS_ALLOWED_ORIGINS`、`TTS_TOKEN_SECRET`、`TTS_REQUIRE_DISTRIBUTED_LIMIT` 與 `CRON_SECRET`。
- 請在部署平台啟用 TTS 的 WAF／Bot 防護與 Vercel Cron。
