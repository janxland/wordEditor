# 妯℃澘鏍峰紡 DSL 瑙勮寖

> 閫傜敤浜?`services/api-python/pipeline/postprocess_styles.py`銆傛瘡涓ā鏉跨洰褰曚笅鏀句竴浠?`styles.yaml`锛岀敱 `build.py` 鍦?`postprocess_document.py` 涔嬪悗鍔犺浇骞舵敼鍐?`word/styles.xml`銆?
## 1. 鍗曚綅涓庢湳璇?
| 瀛楁 | 鍗曚綅 | 渚嬪瓙 | 璇存槑 |
|---|---|---|---|
| `size_half_pt` | 鍗婄 | 21 = 灏忓洓(10.5pt)銆?4 = 灏忎笁(12pt)銆?8 = 灏忎簩(14pt) | OOXML `w:sz w:val=` 鐨勫師鐢熷崟浣?|
| `spacing_before_dxa` / `spacing_after_dxa` | dxa = 1/20 pt | 240 = 涓€琛?12pt)銆?20 = 鍗婅 | `w:spacing before/after` |
| `line_spacing` | enum 鎴栧崐纾?| `single` / `1.5` / `double` / `360` | 鍗曞€?240锛?.5=360锛屽弻鍊?480 |
| `*_indent_chars` | 涓枃瀛楃 | 2 = 涓ゅ瓧绗?| 鑷姩鎹㈢畻涓?`firstLineChars=200, firstLine=420` |
| `align` | enum | `left` / `center` / `right` / `both` / `distribute` | `w:jc w:val=` |

## 2. 椤跺眰缁撴瀯

```yaml
template:
  id: <妯℃澘 id锛屼笌 config/templates.json 涓€鑷?
  name: <鏄剧ず鍚?

fonts:
  latin: Times New Roman    # 鍏ㄥ眬瑗挎枃瀛椾綋锛屽彲鍦ㄦ牱寮忛噷鍐?latin_font: inherit 寮曠敤
  cjk: 瀹嬩綋                 # 鍏ㄥ眬涓枃瀛椾綋锛坣ull = 涓嶅姩妯℃澘榛樿锛?
overrides:                  # 瑕嗙洊宸叉湁鏍峰紡锛堟寜 match 閫夋嫨锛?  - match: { kind: heading }
    word_wrap_break_latin: true
    clear_indent: true
    latin_font: inherit

custom_styles:              # 鏂板 / 閲嶅啓鑷畾涔夋牱寮忥紙鎸?name 鍖归厤锛岀己澶卞垯寤猴級
  - id: Cankaowenxian
    name: 鍙傝€冩枃鐚?    based_on: a
    paragraph: { ... }
    run:       { ... }

semantics: { ... }          # 浠呬綔鏂囨。锛屼笌 Lua filter 瀵圭収
headings:   [ ... ]         # 浠呬綔鏂囨。锛屼笌 postprocess_document.py 鏍囬瑙勫垯瀵圭収
```

## 3. `match` 閫夋嫨鍣?
浠婚€夊叾涓€鎴栫粍鍚堬細

| 瀛楁 | 鍚箟 |
|---|---|
| `id` | 绮剧‘鍖归厤 `w:styleId` |
| `name` | 绮剧‘鍖归厤 `<w:name w:val>` |
| `name_regex` | 姝ｅ垯鍖归厤 name锛堝皬鍐欏寲鍚庯級 |
| `kind` | `heading`锛圚eading 1鈥? / 鏍囬 1鈥?锛夋垨 `body`锛圢ormal / 鏂囩珷鐨勬鏂囷級 |

## 4. `overrides` / `custom_styles` 鍏变韩瀛楁

### paragraph

| 瀛楁 | 绫诲瀷 | 浣滅敤 | 鐢熸垚 OOXML |
|---|---|---|---|
| `word_wrap_break_latin` | bool | 鍏佽瑗挎枃涓棿鏂锛堥伩鍏嶄袱绔榻愭椂澶х┖鏍硷級 | `<w:wordWrap w:val="0"/>` |
| `clear_indent` / `indent_clear` | bool | 鍒犻櫎 `<w:ind>` 涓?`<w:tabs>` | 鈥?|
| `align` | enum | 瀵归綈 | `<w:jc>` |
| `line_spacing` | enum/num | 琛岃窛 | `<w:spacing line= lineRule=>` |
| `spacing_before_dxa` / `spacing_after_dxa` | int | 娈靛墠/娈靛悗 | `<w:spacing before= after=>` |
| `hanging_indent_chars` | int | 鎮寕缂╄繘锛堝弬鑰冩枃鐚?`[1] ` 瀵归綈锛?| `<w:ind leftChars hangingChars hanging firstLine>` |
| `first_line_chars` | int | 棣栬缂╄繘 | `<w:ind firstLineChars firstLine>` |

### run

| 瀛楁 | 绫诲瀷 | 浣滅敤 |
|---|---|---|
| `latin_font` | str / `inherit` | 璁?`rFonts ascii hAnsi cs` |
| `cjk_font`   | str / `inherit` | 璁?`rFonts eastAsia` |
| `size_half_pt` | int | 瑗挎枃瀛楀彿 `w:sz` |
| `size_cs_half_pt` | int | 澶嶆潅鏂囩瀛楀彿 `w:szCs`锛堟湭璁炬椂涓?`size_half_pt` 鐩稿悓锛?|
| `first_line_dxa` | int | 鍙€夛紝瑕嗙洊 `first_line_chars` 鎺ㄧ畻鐨?`w:firstLine`锛坱wips锛?|

## 5. `custom_styles` 琛屼负缁嗚妭

鎵ц椤哄簭锛?1. 鎸?`name` 鏌ユ壘宸叉湁鏍峰紡锛圥andoc 閬囧埌 `<div custom-style="X">` 浼氳嚜鍔ㄧ敓鎴愮┖澹虫牱寮忥級
2. 鍛戒腑锛氭竻绌哄叾 `pPr` 涓?`rPr`锛岀‘淇濇湁 `<w:qFormat/>`锛屽啀鎸?DSL 閲嶅缓
3. 鏈懡涓笖 `id` 涔熶笉瀛樺湪锛氫互鎸囧畾 `id` + `customStyle=1` + `basedOn` 鏂板缓

## 6. `semantics` / `headings`锛堣鏄庢€э級

杩欎袱鑺傚綋鍓?*浠呬綔鏂囨。**鐢ㄩ€斺€斺€旂湡姝ｇ敓鏁堢殑鏄?`zhengwen-style.lua`锛堣涔夋槧灏勶級鍜?`postprocess_document.py`锛堟爣棰樿瘑鍒級銆?
## 7. 绀轰緥

瀹屾暣绀轰緥瑙?[templates/_shared/hutb-base.yaml](../templates/_shared/hutb-base.yaml) 涓?[templates/hutb-guanke/styles.yaml](../templates/hutb-guanke/styles.yaml)銆?
## 8. 璋冪敤

```powershell
py services/api-python/pipeline/postprocess_styles.py output.docx --styles templates/<id>/styles.yaml
```

鐢?`build.py` 鑷姩璋冪敤锛氭寜 `config/templates.json` 涓殑 `styles_yaml` 娉ㄥ叆 OOXML 鏍峰紡銆?
