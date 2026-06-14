# Copilot Instructions 鈥?wordEditor

鏈粨搴撲负 **婀栧崡宸ュ晢澶у** Word 瀵煎嚭绠＄嚎锛坄hutb-guanke` 绠＄ / `hutb-gongke` 宸ョ锛夈€?
## 鏋勫缓

```powershell
py services/api-python/pipeline/build.py -i input/carbon-neutral-renewable.md -t hutb-guanke
```

## 绠＄嚎

MD 鈫?Pandoc锛坄reference.docx` + Lua锛夆啋 DOCX 鈫?`postprocess_document.py`锛堟爣棰?寮曠敤锛夆啋 `postprocess_styles.py`锛坄styles.yaml`锛夈€?
## 鍏抽敭璺緞

| 鐢ㄩ€?| 璺緞 |
|------|------|
| 妯℃澘娉ㄥ唽 | `config/templates.json` |
| 鏍峰紡 DSL 鍩哄簱 | `templates/_shared/hutb-base.yaml` + `templates/_shared/list-style-library.yaml` |
| 鍚勬ā鏉挎牱寮忚鐩?| `templates/hutb-{guanke,gongke,xingce,math-modeling}/styles.yaml` |
| 鍏变韩 reference + Lua | `templates/hutb-shared/`锛坮eference.docx 闇€鑷鏀惧叆锛墊
| 璇箟 Lua | `templates/hutb-shared/zhengwen-style.lua` |
| MD 绾﹀畾 | `docs/markdown-conventions.md` |

## 娉ㄦ剰

- 鍚庡鐞嗘棤闇€ Word锛涗粎闇€ Pandoc + Python + PyYAML
- `reference.docx` 闇€鐢ㄦ埛鑷鏀惧叆瀛︽牎瀹樻柟妯℃澘
- 鍓嶇锛坄apps/wordEditor-frontend`锛変负鍙€夊伐浣滃彴

