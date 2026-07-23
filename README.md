# Block World

Minecraft風のブラウザ3Dブロックゲームです。GitHub Pagesで公開できる静的サイトとして動きます。

## 主な機能

- ランダムなブロックワールド生成
- クリエイティブ / サバイバルモード
- ブロックの破壊・設置・インベントリー
- ワールド別のブロック見た目編集
- 編集したブロック差分の保存
- HP、防具、クラフト、描画距離設定
- iPad向けタッチ操作
- WebRTC方式のボイスチャット
- 同じ信号サーバーを使うテキストチャット共有

## 公開

リポジトリ直下に `index.html` があるため、GitHub Pagesでそのまま公開できます。

## ファイル構成

- `index.html`: 画面UIと読み込み順
- `libs/three.min.js`: Three.js
- `js/blocks.js`: ブロック定義とテクスチャアトラス
- `js/world.js`: ワールド生成、洞窟、チャンクメッシュ、編集差分
- `js/player.js`: プレイヤー移動と当たり判定
- `js/crafting.js`: クラフト定義
- `js/inventory.js`: ホットバー、所持数、防具、リソース定義
- `js/main.js`: ゲーム本体、UI、保存、入力
- `server/voice-server.js`: ボイスチャットとテキストチャット用の信号サーバー

## Auto Push

変更をGitHubへ自動反映したい場合は、Node版のウォッチャーを使います。

```bash
npm install
npm run auto-push
```

Windowsでは `scripts/start-auto-push.cmd`、macOS / Linuxでは `scripts/start-auto-push.sh` からも起動できます。

共同編集で衝突した場合は `.auto-push.log` にエラーを書きます。衝突を直してから、もう一度ウォッチャーを起動してください。

## Voice / Chat Server

ゲーム内ボイスチャットと共有チャットは WebRTC / WebSocket を使います。GitHub Pages だけでは相手を探せないため、別サーバーで `server/voice-server.js` を起動してください。

ローカル確認:

```bash
npm install
npm run start:voice
```

公開する場合は Render / Railway / Fly.io などにこのリポジトリをつなぎ、起動コマンドを `npm run start:voice` にします。公開URLが `https://example.com` の場合、ゲーム側のボイス設定には `wss://example.com` を入力します。
