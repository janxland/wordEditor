/** 首页落地页 —— 面向下单人：说清服务、三步流程、一个主行动点（Apple 风格版） */
import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { WechatOutlined, CopyOutlined, CheckOutlined } from '@ant-design/icons';
import './landing.css';

const WECHAT_ID = 'janxland';
const WECHAT_QR_URL =
  'https://mybox-1257251314.cos.ap-chengdu.myqcloud.com/upload/myself/wechat.jpg';

const STEPS = [
  {
    no: '01',
    title: '提交论文需求',
    desc: '新建工单，说明论文类型与当前进度 —— 从零开始或已有文稿都可以，要求一次讲清。',
  },
  {
    no: '02',
    title: '全流程辅导推进',
    desc: '专属团队接单，内容与格式全程负责；每一步进展都在工单中心实时可见。',
  },
  {
    no: '03',
    title: '验收定稿',
    desc: '成品在线检查，不满意随时提出修改；确认满意后，才正式交付。',
  },
];

const VALUE_POINTS = [
  { title: '全流程负责', desc: '内容、格式、排版定稿都由我们推进，你只需要把关方向与结果。' },
  { title: '进度实时可见', desc: '每个阶段的状态都在工单中心实时更新，做到哪一步一目了然。' },
  { title: '满意才交付', desc: '确认前随时可以提出修改，反复打磨到你满意为止。' },
];

/** 滚动渐入：进入视口即加 .is-in */
function useReveal() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const targets = root.querySelectorAll('.rv');
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add('is-in');
            io.unobserve(e.target);
          }
        });
      },
      { threshold: 0.15 },
    );
    targets.forEach((t) => io.observe(t));
    return () => io.disconnect();
  }, []);
  return ref;
}

export const LandingPage: React.FC = () => {
  const navigate = useNavigate();
  const rootRef = useReveal();
  const [copied, setCopied] = useState(false);

  const copyWechat = async () => {
    try {
      await navigator.clipboard.writeText(WECHAT_ID);
    } catch {
      // 剪贴板不可用时降级：选中即可手动复制
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="lp" ref={rootRef}>
      {/* ---- Hero：大标题 + 渐变强调 ---- */}
      <section className="lp-hero">
        <p className="lp-eyebrow rv">论文辅导服务</p>
        <h1 className="lp-title rv">
          论文这件事，
          <br />
          <span className="lp-grad">全程有人</span>
        </h1>
        <p className="lp-sub rv">
          从选题提纲到初稿排版，全流程专业辅导，
          <br className="lp-br" />
          进度实时可查，满意才算交付。
        </p>
        <div className="lp-actions rv">
          <button className="lp-btn lp-btn-primary" onClick={() => navigate('/orders')}>
            立即下单
          </button>

          {/* 微信通道：无需登录，留微信号即可；hover 出二维码 */}
          <span className="lp-wechat-wrap">
            <button
              className="lp-btn lp-btn-ghost"
              title={`微信号 ${WECHAT_ID}，点击复制`}
              onClick={copyWechat}
            >
              <WechatOutlined />
              {copied ? (
                <>
                  <CheckOutlined /> 已复制 {WECHAT_ID}
                </>
              ) : (
                <>
                  {WECHAT_ID} <CopyOutlined className="lp-wx-copy" />
                </>
              )}
            </button>
            <span className="lp-wechat-pop">
              <img src={WECHAT_QR_URL} alt="微信二维码" />
              <em>扫码加微信 · 备注来意</em>
            </span>
          </span>
        </div>
        <p className="lp-no-login rv">
          不想注册？留下微信号即可 —— 我们会主动添加你，对接需求。
        </p>
      </section>

      {/* ---- 三步流程：纵向时间线 ---- */}
      <section className="lp-steps rv">
        {STEPS.map((s, i) => (
          <div className="lp-step" key={s.no}>
            <div className="lp-step-head">
              <span className="lp-step-no">{s.no}</span>
              <h3>{s.title}</h3>
            </div>
            <p>{s.desc}</p>
            {i < STEPS.length - 1 && <div className="lp-step-line" />}
          </div>
        ))}
      </section>

      {/* ---- 价值点：悬浮卡片 ---- */}
      <section className="lp-values">
        {VALUE_POINTS.map((v) => (
          <div className="lp-value rv" key={v.title}>
            <h4>{v.title}</h4>
            <p>{v.desc}</p>
          </div>
        ))}
      </section>

      {/* ---- 深色收尾 CTA ---- */}
      <section className="lp-cta rv">
        <h2>
          论文的事，
          <br />
          现在开始。
        </h2>
        <p>新建工单几分钟完成；也可以添加微信，直接沟通。</p>
        <div className="lp-cta-actions">
          <button className="lp-btn lp-btn-light" onClick={() => navigate('/orders')}>
            新建工单
          </button>
          <span className="lp-wechat-wrap lp-wechat-dark">
            <button
              className="lp-btn lp-btn-outline"
              title={`微信号 ${WECHAT_ID}，点击复制`}
              onClick={copyWechat}
            >
              <WechatOutlined />
              {copied ? (
                <>
                  <CheckOutlined /> 已复制
                </>
              ) : (
                <>微信联系</>
              )}
            </button>
            <span className="lp-wechat-pop">
              <img src={WECHAT_QR_URL} alt="微信二维码" />
              <em>扫码加微信 · 备注来意</em>
            </span>
          </span>
        </div>
      </section>

      <footer className="lp-foot">
        <span>下单人：首页和工单中心就够了</span>
        <span className="lp-foot-sep">·</span>
        <span>制作人：制作工具收拢在侧边栏「制作工具」分组</span>
      </footer>
    </div>
  );
};
