# 鏁板寤烘ā 2013 A 棰樼ず渚?

鏉ユ簮锛氬鐢熸彁浜ょ殑 docx銆婁氦閫氫簨鏁呭奖鍝嶄笅鐨勫煄甯傞亾璺€氳鑳藉姏涓庢帓闃熼暱搴﹂娴嬬爺绌躲€嬨€?
閫氳繃 `services/api-python/pipeline/extract_docx_to_md.py` 鎻愬彇寰楀埌鏈洰褰曠殑 Markdown + 鍥剧墖銆?

## 閲嶆柊鐢熸垚

```powershell
# 1. 浠?docx 鎻愬彇 鈫?褰撳墠鐩綍
py services/api-python/pipeline/extract_docx_to_md.py `
  -i <婧?docx 璺緞> `
  -o "input/鏁板寤烘ā2013A棰?杞﹂亾琚崰鐢ㄥ鍩庡競閬撹矾閫氳鑳藉姏鐨勫奖鍝?md" `
  --image-dir "input/鏁板寤烘ā2013A棰?images" `
  --image-rel "images"

# 2. 淇 OMML 鈫?鍐呰仈鏁板锛堝惎鍙戝紡锛氳ˉ \frac / \alpha 绛夊懡浠ょ殑鍙嶆枩鏉狅紱
#    鍚腑鏂?缂栧彿 `#` 鐨勮鍐?浼叕寮?闄嶇骇涓哄弽寮曞彿浠ｇ爜鍧楋級
py services/api-python/pipeline/tools/_repair_math_inline.py "input/鏁板寤烘ā2013A棰?杞﹂亾琚崰鐢ㄥ鍩庡競閬撹矾閫氳鑳藉姏鐨勫奖鍝?md"

# 3. 濂楃敤 hutb-math-modeling 妯℃澘瀵煎嚭 docx
py services/api-python/pipeline/build.py -t hutb-math-modeling `
  -i "input/鏁板寤烘ā2013A棰?杞﹂亾琚崰鐢ㄥ鍩庡競閬撹矾閫氳鑳藉姏鐨勫奖鍝?md" `
  -o "output/鏁板寤烘ā2013A棰?docx"
```

## 宸茬煡浜哄伐淇ˉ鐐?

- YAML title / 椤剁骇 `#` 鏍囬锛氬師 docx 灏侀潰椤碉紙鍚绋嬩俊鎭〃锛夎鍓ラ櫎锛岀粺涓€浠?`# 杞﹂亾琚崰鐢ㄥ鍩庡競閬撹矾閫氳鑳藉姏鐨勫奖鍝峘 璧风瘒銆?
- 銆屽洓銆?鏁版嵁鑾峰彇涓庡鐞嗐€嶏細鍘?docx 璇ユ涓烘鏂囨牱寮忚€岄潪 Heading锛屽凡鎵嬪姩鏀逛负 `# 鏁版嵁鑾峰彇涓庡鐞哷銆?
- OMML 鍏紡浠呰兘鍙栧埌 `m:t` 搴忓垪鏂囨湰锛岀粨鏋勪涪澶憋紙濡?`\frac{n_k}{n}` 鈫?`fracnkn`锛夈€傝剼鏈甯歌鍛戒护鍋氫簡鍙嶆枩鏉犺ˉ鍏紱鍚?CJK / `#锛堢紪鍙凤級` 鐨勪吉鍏紡鏁翠綋闄嶇骇涓哄弽寮曞彿浠ｇ爜锛岄伩鍏?Pandoc TeX 瑙ｆ瀽澶辫触銆?
- 閮ㄥ垎鍥剧墖鍦ㄥ師 docx 涓噸澶嶅紩鐢ㄥ悓涓€ rId锛屽鍑哄悗浼氱湅鍒?`image05` 涔嬪悗鐨勫浘搴忎笌姝ｆ枃 "鍥?N" 鏍囧彿涓嶈繛缁紝闇€瑕佹椂鎸夊浘娉ㄩ『搴忓湪 Markdown 涓垹闄ゅ浣?`![]()`銆?

