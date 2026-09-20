# jevtetris

Jev と人間が対戦できる、ブラウザーで動く 1 対 1 テトリスです。Jev には合法手を先に列挙して渡し、現在の盤面・NEXT・HOLD・おじゃま・攻撃状況を共有したうえで、置き場所を型付き評価してもらいます。

公開版: [https://jevtetris.vercel.app](https://jevtetris.vercel.app)

## 日本語

### 必要なもの

- Node.js 22 以上
- Jev を呼び出すサービスの API キーを 1 つ

### ローカル起動

```bash
npm install
cp .env.local.example .env.local
# .env.local に使うプロバイダのキーを1つ設定
npm run dev
```

`http://localhost:3000` を開き、`Start match` で対戦を始めます。ポートを変える場合は `npm run dev -- --port 3010` のように指定してください。

### 対応する Jev プロバイダ

`.env.local.example` に全項目の空欄を用意しています。使うサービスの項目だけ設定してください。

| プロバイダ | 必須環境変数 | 既定モデル | 接続方式 |
| --- | --- | --- | --- |
| TypeSafe 公式 | `TYPESAFE_AI_API_KEY` または `TYPESAFE_API_KEY` | `jev-latest` | AI SDK の公式 TypeSafe プロバイダ |
| Vercel AI Gateway | `AI_GATEWAY_API_KEY` または Vercel 上の `VERCEL_OIDC_TOKEN` | `typesafe-ai/jev-latest` | AI SDK Gateway の Evaluation API |
| OpenRouter | `OPENROUTER_API_KEY` | `typesafe/jev-1.13` | OpenRouter Decisions API |
| Cloudflare AI Gateway / Workers AI | `CLOUDFLARE_API_TOKEN` と `CLOUDFLARE_ACCOUNT_ID` | `typesafe/jev` | Cloudflare `/ai/run` REST API |

選択は `JEV_PROVIDER=auto`（既定）または `typesafe` / `vercel` / `openrouter` / `cloudflare` で固定できます。`auto` は、設定済みの TypeSafe、Vercel、OpenRouter、Cloudflare の順に選びます。複数のキーを設定する場合は、意図しない請求先を避けるため `JEV_PROVIDER` を明示してください。

モデルを変更する場合は、次の環境変数を使います。

```dotenv
TYPESAFE_AI_BASE_URL=https://api.typesafe.ai/v1
OPENROUTER_JEV_MODEL=typesafe/jev-1.13
CLOUDFLARE_JEV_MODEL=typesafe/jev
CLOUDFLARE_AI_GATEWAY_ID=default
```

Cloudflare の `CLOUDFLARE_AI_GATEWAY_ID` は任意です。指定すると `cf-aig-gateway-id` ヘッダーでその Gateway にルーティングします。

### キーの扱い

- API キーはサーバー側の環境変数だけで読み取ります。`NEXT_PUBLIC_` を付けないでください。
- `.env.local` は `.gitignore` 対象です。`.env.local.example` には空欄だけを置きます。
- キーを誤って公開した場合は、プロバイダ側で直ちに無効化して再発行してください。
- Vercel では Project Settings の Environment Variables に同じ変数を登録し、Production / Preview / Development の適用範囲を選びます。
- API キーが無い、認証に失敗する、レート制限になる、または応答がタイムアウトした場合も、人間側のゲームは停止せず、安全なローカル合法手へ切り替えます。

### 操作

| 操作 | キー |
| --- | --- |
| 左右移動 | ← / → |
| ソフトドロップ | ↓ |
| 時計回り回転 | ↑ / X |
| 反時計回り回転 | Z |
| ハードドロップ | Space |
| HOLD | C / Shift |

画面内の操作ボタンはタッチでも使えます。重力は判断・操作中も進み、NEXT・HOLD・おじゃま予定・ロック残時間を Jev の判断入力に含めます。

### ルールの概要

- 10×20 盤面、7-bag、SRS 回転と wall kick、接地ロック猶予を使います。
- 1 / 2 / 3 / 4 ライン、T-Spin、REN、B2B、Perfect Clear と、おじゃまの相殺・送信を対戦状態へ反映します。
- 公式タイトルごとに数値が異なるため、このアプリでは仕様を `docs/spec.md` に固定したローカル 1 対 1 ルールとして扱います。
- Jev の Gateway / プロバイダ評価は通常 1 ピース 1 回です。評価中もゲームの重力は止まりません。

### 開発チェック

```bash
npm run lint
npm run typecheck
npm run build
```

CI ではこれらを実行し、API キーを使う評価リクエストは送信しません。

### ディレクトリ

- `src/app/page.tsx` — JevTetris の画面
- `src/components/tetris-game.tsx` — 対戦ループ、操作、Jev HUD
- `src/lib/tetris.ts` — 盤面、7-bag、SRS、攻撃・おじゃま計算
- `src/lib/jev-provider.ts` — Jev プロバイダの共通アダプター
- `src/app/api/tetris/choose/route.ts` — サーバー側の合法手評価 API
- `docs/` — 仕様・設計判断・変更履歴

以前の Decision Lab はメインアプリから分離し、ローカルの `../jev-decision-lab` リポジトリへ退避しています。

## English

### What it is

`jevtetris` is a browser based 1v1 Tetris game where a human plays against Jev. The server enumerates legal placements first, then sends the board, NEXT, HOLD, incoming garbage, and battle state to a typed Jev evaluation.

Live demo: [https://jevtetris.vercel.app](https://jevtetris.vercel.app)

### Requirements and local setup

- Node.js 22 or newer
- One API credential for a Jev provider

```bash
npm install
cp .env.local.example .env.local
# set one provider credential in .env.local
npm run dev
```

Open `http://localhost:3000` and press `Start match`. Use `npm run dev -- --port 3010` when another port is needed.

### Provider configuration

Set only the variables for the provider you use:

| Provider | Required environment variables | Default model | Transport |
| --- | --- | --- | --- |
| Official TypeSafe | `TYPESAFE_AI_API_KEY` or `TYPESAFE_API_KEY` | `jev-latest` | Official TypeSafe AI SDK provider |
| Vercel AI Gateway | `AI_GATEWAY_API_KEY` or Vercel `VERCEL_OIDC_TOKEN` | `typesafe-ai/jev-latest` | AI SDK Gateway Evaluation API |
| OpenRouter | `OPENROUTER_API_KEY` | `typesafe/jev-1.13` | OpenRouter Decisions API |
| Cloudflare AI Gateway / Workers AI | `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` | `typesafe/jev` | Cloudflare `/ai/run` REST API |

Use `JEV_PROVIDER=auto` (the default), or pin it to `typesafe`, `vercel`, `openrouter`, or `cloudflare`. Auto selection checks TypeSafe, Vercel, OpenRouter, then Cloudflare. Pin the provider when more than one credential is present so billing is explicit.

Optional model and Gateway settings:

```dotenv
TYPESAFE_AI_BASE_URL=https://api.typesafe.ai/v1
OPENROUTER_JEV_MODEL=typesafe/jev-1.13
CLOUDFLARE_JEV_MODEL=typesafe/jev
CLOUDFLARE_AI_GATEWAY_ID=default
```

### Credential safety

- Credentials are read only on the server. Never use a `NEXT_PUBLIC_` prefix.
- `.env.local` is ignored by Git. The committed example contains empty values only.
- Revoke and rotate a credential immediately if it was exposed.
- In Vercel, add the same variables under Project Settings → Environment Variables and choose the required environments.
- If a provider is missing, rejects the request, rate limits, or times out, the match continues with a deterministic local legal move.

### Controls and rules

The controls are ← / →, ↓, ↑ or X, Z, Space, and C or Shift for HOLD. Touch controls are also available. Gravity continues while Jev is thinking, and Jev receives NEXT, HOLD, incoming garbage, and the remaining lock time.

The game uses a 10×20 board, a 7-bag generator, SRS rotation and wall kicks, lock delay, line attacks, T-Spins, REN, back-to-back, Perfect Clear, and garbage cancellation. Exact battle values are documented in `docs/spec.md` because official Tetris titles use different tables.

### Checks

```bash
npm run lint
npm run typecheck
npm run build
```

CI runs these checks without making a paid Jev evaluation request.

The former Decision Lab demo is kept separately in the local `../jev-decision-lab` repository and is not part of this application.
