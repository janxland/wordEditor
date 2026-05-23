# 样式预览样例

> 工作台在线预览：与 CLI 示例同结构；图经 CDN 嵌入（可设 WORDEDITOR_PREVIEW_CDN）。

<!-- 双碳目标下风光储协同优化的碳减排效益评估——以华中某省级电网为例 -->
<!-- 预览样例：摘要/关键词/多级标题/公式/图/参考文献 -->

摘要

在「碳达峰、碳中和」战略约束下，高比例新能源接入对电力系统的安全性与经济性提出新要求。本文针对风电与光伏出力的强随机性、反调峰特性以及电网调节能力不足等问题，构建以系统总碳排放成本与运行成本之和最小化为目标的风光储协同优化调度模型。模型在节点功率平衡、机组爬坡约束、储能荷电状态约束之下，引入碳交易价格 \(c_{CO_2}\) 与碳排放强度因子 \(\eta_e\) 作为联系电源结构与减排效益的桥梁，并采用改进的灰狼优化算法（IGWO）求解。以华中某省级电网 2024 年实际运行数据为算例，对比基准火电方案、风光直供方案与风光储协同方案。结果表明：① 风光储协同方案下年减排量较基准方案提升 27.6%，单位 \(\mathrm{kWh}\) 碳排放强度由 0.842 下降至 0.610 \(\mathrm{kg\,CO_2/kWh}\)；② 储能容量在 \(W \times PD_s\) 阈值附近存在拐点，超出后边际减排效益快速递减；③ 当碳价由 60 元/吨上升至 120 元/吨时，最优储能配置容量增加约 34%，且系统综合成本对碳价的弹性系数为 0.41。研究结论可为省级电网制定「十五五」期间储能配置规划与碳市场参与策略提供参考。

**关键词**：双碳目标；新能源消纳；风光储协同；储能优化；碳交易

Abstract

Under the "Carbon Peak and Carbon Neutrality" goals, the increasing penetration of renewables has imposed new requirements on grid security and economics. This paper develops a coordinated wind–solar–storage scheduling model that minimizes the sum of system carbon-emission cost and operating cost, subject to nodal power balance, generator ramping, and battery state-of-charge constraints. A carbon price \(c_{CO_2}\) and a carbon-intensity factor \(\eta_e\) link the generation mix with mitigation benefits, and an improved grey wolf optimizer (IGWO) is used as the solver. A case study on a provincial grid in central China shows that the coordinated scheme reduces annual emissions by 27.6% relative to the thermal baseline, drops emission intensity from 0.842 to 0.610 \(\mathrm{kg\,CO_2/kWh}\), and exhibits a clear marginal turning point of storage capacity. When the carbon price rises from 60 to 120 CNY/t, optimal storage capacity grows by about 34%, with a cost elasticity of 0.41 to carbon price. The results inform storage planning and carbon-market participation for provincial grids during the 15th Five-Year period.

**Keywords**: dual-carbon goals; renewable accommodation; wind–solar–storage coordination; energy-storage optimization; carbon trading

一、绪论

气候变化已成为全球面临的最严峻挑战之一。为兑现《巴黎协定》承诺，我国于 2020 年提出 2030 年前实现碳达峰、2060 年前实现碳中和的「双碳」目标[1]。电力部门作为最大的碳排放源，其低碳转型直接决定双碳目标能否如期达成[2]。

1.1 研究背景

国家能源局发布的《新型电力系统发展蓝皮书》明确，到 2030 年风电、太阳能发电装机容量将达到 12 亿千瓦以上，新能源在电源结构中的主体地位逐步确立[3]。然而风光出力的间歇性与波动性使得「弃风弃光」与「煤电备用」长期并存，制约减排效益的实质性释放[4]。储能技术被普遍视为破解上述矛盾的关键枢纽，但储能投资强度大、技术路线多元，亟需在系统层面给出与碳市场机制耦合的协同优化方案[5]。

1.1.1 双碳政策演进

自 2020 年「3060」目标提出以来，中央与地方陆续发布 70 余项配套政策。2021 年「1+N」政策体系中的「能耗双控」逐步过渡到「碳排放双控」，价格信号由行政约束转向市场约束[6]。2023 年生态环境部启动全国统一碳排放权交易市场，2024 年扩容至钢铁、水泥与电解铝行业；碳价中枢由 2021 年的约 45 元/吨上升至 2024 年的 90 元/吨左右[7]。

1.1.1.1 试点省份比较

广东、湖北、上海三地碳市场起步早，其纳入门槛、配额分配方式各有侧重。广东以拍卖比例高、流动性强见长；湖北以预付保证金机制保障履约率；上海则较早试点 CCER 抵消机制[8]。这些差异化经验为全国统一市场扩容提供了直接参考。

1.1.2 新能源装机现状

截至 2024 年底，全国风电装机 4.6 亿千瓦、光伏装机 7.1 亿千瓦，分别同比增长 19.4% 与 35.8%[9]。但同期全国弃风率、弃光率分别为 3.5% 与 2.4%，西北部分省份弃风率超过 8%，新能源消纳压力突出[10]。

1.2 研究意义

本文意义可概括为三方面：① 在模型层面，将碳价与碳排放强度内生化，使得系统优化结果对市场机制具有可解释性；② 在算法层面，采用收敛性更好的 IGWO 求解大规模混合整数非线性规划，提升计算效率；③ 在政策层面，结合算例量化储能容量—碳价—减排收益的弹性关系，为「十五五」规划提供数量依据。

1.3 论文结构

后文安排如下：第二节回顾相关文献并指出研究缺口；第三节构建风光储协同优化模型；第四节给出算例分析与敏感性测试；第五节归纳结论并提出政策建议。

二、文献综述

2.1 双碳目标下电力系统转型研究

围绕电力系统低碳转型，现有研究可分为情景模拟、技术经济评估与机制设计三条主线[1]。Zhang 等基于 TIMES 模型测算 2060 年电力部门净零排放路径，指出风光发电占比需突破 65%[11]。陈等利用电力—碳—经济耦合模型评估了不同碳价情景下煤电的退出时序，强调储能与需求响应的协同价值[12]。机制设计方面，碳市场、绿证市场、电力现货市场的「三市场协同」已成为政策关注焦点[13]。

2.2 风光储协同优化研究

风光储协同优化模型按时间尺度可分为长期规划与日内调度两类。长期规划侧重容量配置，常采用混合整数规划求解全寿命周期成本最小化问题[14]；日内调度关注 15 分钟级功率平衡，需要兼顾爬坡、备用与储能荷电状态约束[15]。近年来双层规划与机会约束规划成为处理不确定性的主流框架，但在与碳市场耦合的研究仍较匮乏[16]。

2.3 储能优化与碳市场耦合研究

储能与碳市场耦合的核心在于将碳价信号反映在储能充放电策略中。Li 等提出考虑碳交易的电池储能调度策略，验证了碳价 80 元/吨为储能由「调峰」转向「碳套利」的拐点[17]。Wang 等进一步引入碳金融衍生品，研究储能在期现两市场的协同收益，但模型对负荷预测误差的鲁棒性仍待提升[18]。

2.4 研究缺口

综上，已有文献多侧重模型构建或单一机制研究，缺乏在统一框架下定量给出「储能容量—碳价—减排效益」三者弹性关系的实证。本文针对此缺口，构建耦合碳市场的风光储协同优化模型，并以省级电网真实数据为例进行系统化测算。

三、研究方法

3.1 系统建模

3.1.1 风电出力模型

风电机组实际出力 \(P_w(t)\) 与轮毂高度处风速 \(v(t)\) 之间满足典型的分段函数关系：

设切入风速 \(v_{in}\)、额定风速 \(v_r\)、切出风速 \(v_{out}\) 与额定功率 \(P_r\)，则有 \(P_w(t)=0\)（当 \(v(t) \le v_{in}\) 或 \(v(t) \ge v_{out}\)），\(P_w(t)= P_r \cdot \dfrac{v(t)^3 - v_{in}^3}{v_r^3 - v_{in}^3}\)（当 \(v_{in} < v(t) < v_r\)），以及 \(P_w(t)= P_r\)（当 \(v_r \le v(t) < v_{out}\)）。

3.1.2 光伏出力模型

光伏阵列输出功率与太阳辐照度 \(I(t)\) 及组件温度 \(T_c(t)\) 相关，可表示为 \(P_{pv}(t) = P_{stc} \cdot \dfrac{I(t)}{I_{stc}} \cdot \left[1 + \gamma (T_c(t) - T_{stc}) \right]\)，其中 \(\gamma\) 为温度系数，下标 stc 表示标准测试条件。

3.1.3 储能模型

锂离子电池储能荷电状态 (SOC) 演化满足

$$
SOC(t+1) = SOC(t) + \frac{\eta_c P_{ch}(t) - P_{dis}(t)/\eta_d}{E_{cap}} \Delta t
$$

其中 \(\eta_c\)、\(\eta_d\) 分别为充、放电效率，\(E_{cap}\) 为额定容量，\(\Delta t\) 取 15 分钟。

3.2 优化目标

目标函数取系统综合成本 \(C_{tot}\) 最小：\(C_{tot} = C_{ope} + C_{co_2} + C_{ess}\)，其中运行成本 \(C_{ope}\) 包含燃料与启停成本；碳成本 \(C_{co_2} = c_{CO_2} \cdot \sum_{t} \eta_e(t) \cdot P_{th}(t) \cdot \Delta t\)；储能折旧成本 \(C_{ess}\) 按全寿命周期摊销。

3.2.1 约束条件

模型主要约束包括：节点功率平衡 \(\sum P_g(t) + P_{dis}(t) - P_{ch}(t) = P_{load}(t)\)；火电机组爬坡 \(\left| P_{th}(t) - P_{th}(t-1) \right| \le R_{up}\)；储能 SOC 上下限 \(SOC_{min} \le SOC(t) \le SOC_{max}\)；以及新能源出力上限 \(P_{w}(t) \le P_{w}^{max}(t)\)、\(P_{pv}(t) \le P_{pv}^{max}(t)\)。

3.3 求解算法

3.3.1 算法流程

考虑模型为大规模混合整数非线性规划，本文采用改进灰狼优化（IGWO）求解。IGWO 在标准 GWO 基础上引入 Logistic 混沌初始化与差分变异，提升全局搜索能力。算法主要步骤为：① 种群初始化；② 评估适应度并排序得到 \(\alpha\)、\(\beta\)、\(\delta\) 狼；③ 按动态权重更新狼群位置；④ 满足收敛准则后输出。

3.3.2 收敛性分析

在迭代次数 \(K=200\)、种群规模 \(N=80\) 的设定下，IGWO 在算例上的收敛误差较 PSO 降低 38.4%、较标准 GWO 降低 21.2%，平均收敛代数 \(\bar{K}=92\)，能够满足工程应用要求。

四、案例分析

4.1 算例参数

以华中某省级电网为研究对象，2024 年最大负荷 32 GW，年用电量 1730 亿 \(\mathrm{kWh}\)。电源结构包括 18.5 GW 火电、5.2 GW 水电、6.8 GW 风电、9.3 GW 光伏及 1.5 GW/3 GWh 已建储能。碳排放强度 \(\eta_e\) 基础取 0.842 \(\mathrm{kg\,CO_2/kWh}\)，碳价基准 90 元/吨。

4.1.1 数据来源

风光出力曲线取自电网调度中心 2024 年全年 96 点采样数据；负荷曲线取自当年 7 月 24 日典型夏季高峰日；机组参数参考《中国电力工业统计资料汇编（2024）》[19]。

4.2 结果与讨论

4.2.1 减排效益对比

三种方案的减排效果如下：基准火电方案年碳排放 1.46 亿吨；风光直供方案 1.21 亿吨，较基准下降 17.1%；风光储协同方案 1.06 亿吨，较基准下降 27.6%、较风光直供再降 12.5%。结果表明，储能不仅消纳了 11.4% 的额外新能源电量，还显著缓解了火电的反调峰运行需求[12]。

![三种方案年碳排放对比（百万吨 CO2）](https://cdn.jsdelivr.net/gh/janxland/wordEditor@main/input/images/fig-emission.png)

4.2.2 经济性对比

风光储协同方案年综合成本 286.4 亿元，较基准方案上升 4.3%、较风光直供方案下降 2.1%。其中：燃料成本下降 18.7%；碳成本下降 27.6%；储能折旧增加 19.2 亿元。考虑碳市场收益后，方案净成本反低于基准 1.8%[17]。

4.2.3 边际效益拐点

在不同储能容量下，单位 \(\mathrm{kWh}\) 减排成本呈现明显的「先降后升」U 形曲线，拐点出现在 \(W \times PD_s\) 约等于 1.2 GWh 处。当储能容量超过该拐点后，由于充放电次数受限与折旧分摊增加，单位减排成本快速上升。

![储能容量与单位减排成本的 U 形关系](https://cdn.jsdelivr.net/gh/janxland/wordEditor@main/input/images/fig-marginal.png)

4.3 敏感性分析

将碳价由 60 元/吨依次提升至 90、120、150 元/吨，最优储能配置容量依次为 2.1、2.8、3.3、3.7 GWh；系统综合成本对碳价的弹性系数为 0.41，意味着碳价每上升 10%，综合成本相应上升 4.1%，但减排量上升 6.7%，呈现「价格促减排」的非对称效应[18]。

4.3.1 不确定性讨论

负荷与新能源出力的预测误差服从均值为零、标准差为 \(\sigma\) 的正态分布。当 \(\sigma\) 由 5% 上升到 15% 时，最优储能容量需上调 14%；若同时考虑机会约束置信度 95%，则模型综合成本上升 3.2%，但弃风弃光率可从 6.3% 降至 2.1%[15]。

五、结论与建议

5.1 主要结论

本文构建了耦合碳市场的风光储协同优化模型，并以华中某省级电网 2024 年实际数据为例，系统量化了风光储协同方案的碳减排效益与经济性。主要结论包括：① 风光储协同较基准方案减排 27.6%、较风光直供再减 12.5%；② 储能容量存在显著的边际效益拐点，超过拐点后单位减排成本快速回升；③ 系统综合成本对碳价的弹性系数为 0.41，碳价与储能容量呈正相关；④ 在新能源高比例情景下，机会约束规划可显著降低弃风弃光率。

5.2 政策建议

针对前述结论，提出以下建议：① 在「十五五」规划中将储能容量配置与省级碳排放约束联动；② 推动绿证、CCER 与电力现货市场的「三市场协同」结算机制[13]；③ 完善碳价发现机制，避免短期价格剧烈波动对储能投资形成抑制；④ 鼓励虚拟电厂、需求侧响应与新型储能融合发展，形成多元化灵活性资源池[16]。

5.3 研究展望

未来工作将从两方面深化：一是引入电氢耦合与跨省互济，拓展模型边界；二是结合区块链与可信计算，研究碳资产可信确权与跨链交易，提升碳市场治理的透明度与效率。

参考文献

<a id="Ref1"></a>[1] 中共中央, 国务院. 关于完整准确全面贯彻新发展理念做好碳达峰碳中和工作的意见[Z]. 北京: 中共中央, 2021.

<a id="Ref2"></a>[2] 国家能源局. 新型电力系统发展蓝皮书[R]. 北京: 国家能源局, 2023.

<a id="Ref3"></a>[3] 舒印彪, 谢典. 新型电力系统建设的关键技术挑战与展望[J]. 中国电机工程学报, 2023, 43(15): 5717-5731.

<a id="Ref4"></a>[4] 周孝信, 鲁宗相, 黄越辉, 等. 高比例可再生能源电力系统的关键科学问题[J]. 电力系统自动化, 2022, 46(11): 1-12.

<a id="Ref5"></a>[5] Yang Y, Bremner S, Menictas C, et al. Battery energy storage system size determination in renewable energy systems: A review[J]. Renewable and Sustainable Energy Reviews, 2018, 91: 109-125.

<a id="Ref6"></a>[6] 生态环境部. 关于做好 2023—2025 年部分重点行业企业温室气体排放报告与核查工作的通知[Z]. 北京, 2023.

<a id="Ref7"></a>[7] 张希良, 张达, 余润心. 全国碳市场建设进展与展望[J]. 中国环境管理, 2024, 16(2): 5-12.

<a id="Ref8"></a>[8] 段茂盛, 庞韬. 中国试点碳市场运行机制比较研究[J]. 中国人口·资源与环境, 2022, 32(8): 31-42.

<a id="Ref9"></a>[9] 国家能源局. 2024 年全国电力工业统计数据[EB/OL]. (2025-01-20).

<a id="Ref10"></a>[10] 全国新能源消纳监测预警中心. 2024 年全国新能源并网消纳情况[R]. 北京, 2025.

<a id="Ref11"></a>[11] Zhang X, Huang X, Zhang D, et al. Pathways to net-zero emissions for China's power sector[J]. Energy, 2022, 257: 124692.

<a id="Ref12"></a>[12] 陈大宇, 王锡凡. 双碳目标下煤电退出时序与储能协同价值评估[J]. 电力系统自动化, 2023, 47(4): 1-11.

<a id="Ref13"></a>[13] 周天睿, 康重庆. 电—碳—证三市场协同机制研究[J]. 电力系统自动化, 2024, 48(2): 1-13.

<a id="Ref14"></a>[14] Liu H, Wu Q, Li C. Two-stage stochastic programming for wind-solar-storage capacity planning[J]. Applied Energy, 2021, 295: 117045.

<a id="Ref15"></a>[15] 鲁宗相, 林今, 乔颖. 含高比例新能源的电力系统机会约束调度[J]. 中国电机工程学报, 2022, 42(20): 7273-7286.

<a id="Ref16"></a>[16] Wang Z, Chen Y, Mei S. Bi-level optimization of integrated energy systems considering carbon market[J]. IEEE Transactions on Sustainable Energy, 2023, 14(3): 1574-1586.

<a id="Ref17"></a>[17] Li S, Xu Q, Liu J. Carbon-aware operation strategy for battery energy storage[J]. Journal of Energy Storage, 2023, 60: 106701.

<a id="Ref18"></a>[18] Wang J, Zhao H. Coordinated participation of energy storage in spot and carbon derivative markets[J]. Energy Economics, 2024, 127: 107078.

<a id="Ref19"></a>[19] 中国电力企业联合会. 中国电力工业统计资料汇编（2024）[M]. 北京: 中国电力出版社, 2024.
