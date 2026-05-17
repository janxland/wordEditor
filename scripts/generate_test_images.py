"""生成测试图片（无外网依赖），写入 input/images/。"""
from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


def _font(size: int) -> ImageFont.FreeTypeFont:
    for name in ("simhei.ttf", "msyh.ttc", "simsun.ttc", "arial.ttf"):
        try:
            return ImageFont.truetype(name, size=size)
        except OSError:
            continue
    return ImageFont.load_default()


def fig_bar(path: Path) -> None:
    W, H = 760, 360
    img = Image.new("RGB", (W, H), "white")
    d = ImageDraw.Draw(img)
    f_title = _font(20)
    f_label = _font(16)
    bars = [("基准火电", 146, "#7b8a93"),
            ("风光直供", 121, "#3aa3e0"),
            ("风光储协同", 106, "#2ca469")]
    base_y = 300
    bar_w = 110
    gap = 80
    x0 = 90
    max_v = 160
    d.line([(60, base_y), (W - 30, base_y)], fill="black", width=2)
    d.line([(60, 60), (60, base_y)], fill="black", width=2)
    for i, (name, v, c) in enumerate(bars):
        x = x0 + i * (bar_w + gap)
        h = int((v / max_v) * (base_y - 70))
        d.rectangle([x, base_y - h, x + bar_w, base_y], fill=c, outline="black")
        d.text((x + 10, base_y - h - 22), f"{v}", fill="black", font=f_label)
        d.text((x + 5, base_y + 8), name, fill="black", font=f_label)
    d.text((W // 2 - 180, 20), "三种方案年碳排放对比（百万吨 CO₂）", fill="black", font=f_title)
    img.save(path)


def fig_curve(path: Path) -> None:
    W, H = 760, 360
    img = Image.new("RGB", (W, H), "white")
    d = ImageDraw.Draw(img)
    f_title = _font(20)
    f_label = _font(14)
    base_y = 300
    d.line([(60, base_y), (W - 30, base_y)], fill="black", width=2)
    d.line([(60, 60), (60, base_y)], fill="black", width=2)
    # U 形曲线
    import math
    pts = []
    for i in range(0, 40):
        x = 60 + int(i * (W - 100) / 40)
        # 拐点在 i=18
        v = 50 + (i - 18) ** 2 * 0.6
        y = base_y - int((v) * 0.9)
        pts.append((x, y))
    d.line(pts, fill="#d04848", width=3)
    # 拐点标记
    d.ellipse([pts[18][0] - 6, pts[18][1] - 6, pts[18][0] + 6, pts[18][1] + 6],
              outline="black", fill="#fae100")
    d.text((pts[18][0] + 10, pts[18][1] - 10), "拐点 ≈ 1.2 GWh", fill="black", font=f_label)
    d.text((W // 2 - 180, 20), "储能容量与单位减排成本关系", fill="black", font=f_title)
    d.text((W - 200, base_y + 8), "储能容量 (GWh)", fill="black", font=f_label)
    img.save(path)


if __name__ == "__main__":
    out = Path(__file__).resolve().parent.parent / "input" / "images"
    out.mkdir(parents=True, exist_ok=True)
    fig_bar(out / "fig-emission.png")
    fig_curve(out / "fig-marginal.png")
    print(f"OK: {out}")
