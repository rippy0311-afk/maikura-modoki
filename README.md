# Block World

Minecraft風のブラウザ3Dブロックゲームです。GitHub Pagesで公開できる静的サイトとして動きます。

## 主な機能

- ランダムなブロックワールド生成
- クリエイティブ / サバイバルモード
- ブロックの破壊・設置・インベントリー
- ワールド別のブロック見た目編集
- 編集したブロック差分の保存
- HP、クラフト、描画距離設定
- iPad向けタッチ操作
- WebRTC方式のボイスチャット

## 公開

リポジトリ直下に `index.html` があるため、GitHub Pagesでそのまま公開できます。

## ファイル構成

- `index.html`: 画面UIと読み込み順
- `libs/three.min.js`: Three.js
- `js/blocks.js`: ブロック定義とテクスチャアトラス
- `js/world.js`: ワールド生成、洞窟、チャンクメッシュ
- `js/player.js`: プレイヤー移動と当たり判定
- `js/crafting.js`: クラフト定義
- `js/main.js`: ゲーム本体、UI、保存、入力
- `server/voice-server.js`: ボイスチャット用のWebRTC信号サーバー

## Auto push

`scripts/start-auto-push.bat` を起動すると、ファイル変更を検知して自動で `git add -A`、`git commit`、`git pull --rebase`、`git push` を実行します。

共同編集で衝突した場合は `.auto-push.log` にエラーを書いて停止します。衝突を直してから、もう一度 `scripts/start-auto-push.bat` を起動してください。

## Voice chat

ゲーム内ボイスチャットは WebRTC を使います。GitHub Pages だけでは通話相手を探せないため、別サーバーで `server/voice-server.js` を起動してください。

ローカル確認:

```bash
npm install
npm run start:voice
```

公開する場合は Render / Railway / Fly.io などにこのリポジトリをつなぎ、起動コマンドを `npm run start:voice` にします。公開URLが `https://example.com` の場合、ゲーム側のボイス設定には `wss://example.com` を入力します。
