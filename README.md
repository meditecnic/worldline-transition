# worldline-transition

照着《STEINS;GATE》的世界线变动做的一段转场动画，大概 10 秒，网页里跑。本来是给 [AMADEUS](https://github.com/meditecnic/AMADEUS) 做的跃迁演出，还没接进去，先单独放出来。

![锁定在 1.129848 的辉光管](docs/preview.png)

画面全是代码现画的，没用原作的视频、截图或音频。粉丝作品，和官方没关系。

> 有快切、闪白和画面撕裂，对闪光敏感的话请勾「减少动态效果」，或者别看。

## 跑起来

```bash
npm install
npm run dev            # 打开 http://127.0.0.1:5179/
npm run build:single   # 打成一个 html 文件，在 dist-single/ 里，双击就能看
```

点「开始播放」才会动。可以选 SG → β 或 β → SG，也可以模拟成功、偏慢、失败三种结果（都是假的，没接后端）。

## 许可

代码 MIT。字体是 Noto Sans SC 和 IBM Plex Mono，OFL 许可，见 `public/fonts/OFL.txt`。《STEINS;GATE》相关权利归 MAGES. Inc. 等权利人。
