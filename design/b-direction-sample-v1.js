const icons = {
  pin: '<path d="M18 9c0 5-6 11-6 11S6 14 6 9a6 6 0 1 1 12 0Z"/><circle cx="12" cy="9" r="2"/>',
  chevron: '<path d="m9 5 7 7-7 7"/>',
  down: '<path d="m7 10 5 5 5-5"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  calendar: '<rect x="4" y="5" width="16" height="16" rx="3"/><path d="M8 3v4m8-4v4M4 11h16"/>',
  arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
  back: '<path d="m14 5-7 7 7 7"/>',
  boat: '<path d="m3 14 9-4 9 4-3 6H6l-3-6Zm3-1V7h12v6M10 7V3h4v4M2 22c2-2 3 1 5-1s3 1 5 0 3 1 5 0 3 1 5 0"/>',
  rod: '<path d="m4 20 12-16m-8 11 3 3M16 4l4 3v8a3 3 0 0 1-6 0v-2"/><circle cx="6" cy="18" r="2"/>',
  home: '<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z"/>',
  compass: '<circle cx="12" cy="12" r="9"/><path d="m16 8-2 6-6 2 2-6 6-2Z"/>',
  order: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6m-6 4h6m-6 4h4"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  star: '<path d="m12 3 2.8 5.6 6.2.9-4.5 4.4 1.1 6.1-5.6-2.9L6.4 20l1.1-6.1L3 9.5l6.2-.9Z"/>',
  wind: '<path d="M3 8h12a3 3 0 1 0-3-3M3 12h15a3 3 0 1 1-3 3M3 16h6"/>',
  wave: '<path d="M2 8c3-4 7 4 10 0s7 4 10 0M2 13c3-4 7 4 10 0s7 4 10 0M2 18c3-4 7 4 10 0s7 4 10 0"/>',
  temp: '<path d="M9 14V5a3 3 0 0 1 6 0v9a5 5 0 1 1-6 0Z"/><path d="M12 8v10"/>',
  tide: '<path d="M3 17c3-4 5 4 9 0s6 4 9 0M12 3v9M8 7l4-4 4 4"/>',
  shield: '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z"/><path d="m8 12 3 3 5-6"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  heart: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z"/>',
  share: '<path d="M12 16V3m-5 5 5-5 5 5M5 13v7h14v-7"/>',
  bell: '<path d="M5 16V9a7 7 0 0 1 14 0v7l2 2H3l2-2Zm5 5h4"/>',
  seat: '<path d="M5 3v9h14V3M3 10v7h18v-7M6 17v4m12-4v4M8 3h8v9H8Z"/>',
};
const icon = (name, cls = '') => `<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.boat}</svg>`;

const fishArt = (type) => {
  const colors = {yellow:['#d5dcd4','#a6baab','#e8c954'], ribbon:['#c6dbdd','#93b1b8','#b0cacf'], squid:['#dccbbf','#ac9a95','#cbafa0'], rock:['#a0aca9','#6b807c','#b3a08a']};
  const [body, back, accent] = colors[type];
  if(type==='squid') return `<svg viewBox="0 0 100 60" aria-hidden="true"><path d="M65 9Q39 7 22 28q16 15 43 15l16-15Z" fill="${body}"/><path d="m43 14 4-9 21 2 8 15M43 40l9 11 22-6 6-14" fill="${accent}" opacity=".6"/><path d="M25 25Q9 15 8 24t13 6M25 30Q5 30 8 39t16-5m2-5Q5 45 20 46" fill="none" stroke="${back}" stroke-width="3" stroke-linecap="round"/><circle cx="28" cy="27" r="2" fill="#243e3b"/></svg>`;
  if(type==='ribbon') return `<svg viewBox="0 0 100 60" aria-hidden="true"><path d="M8 23Q37 9 65 24t28 10Q56 34 35 29T8 31Z" fill="${body}"/><path d="M10 23Q39 13 65 25t28 9" fill="none" stroke="${back}" stroke-width="2"/><circle cx="14" cy="26" r="1.5" fill="#243e3b"/></svg>`;
  return `<svg viewBox="0 0 100 60" aria-hidden="true"><path d="m75 27 17-12-3 15 3 15-17-11Q42 55 9 29q31-25 66-2Z" fill="${body}"/><path d="M14 25q30-19 61 2" fill="none" stroke="${back}" stroke-width="7"/><path d="m37 18 13-9 12 11m-23 21 17 9 5-12" fill="${back}"/><path d="m28 31 44-1" stroke="${accent}" stroke-width="3"/><circle cx="20" cy="27" r="2.2" fill="#203c38"/><path d="M30 23q-6 7 0 13" fill="none" stroke="${back}" stroke-width="1.5"/></svg>`;
};

const status = () => `<div class="status-bar" aria-hidden="true"><b>9:41</b><span class="island"></span><span class="phone-indicators"><i></i><i></i><i></i><span>▰</span></span></div>`;
const meter = (percent) => `<div class="progress-track"><i style="--progress:${percent}%"></i><span></span><span></span><span></span><span></span><span></span></div>`;
const price = (n, unit='位') => `<span class="price"><small>¥</small>${n}<em>/${unit}</em></span>`;
function homeScreen() {
  return `<div class="app-page home-page">
    <div class="app-scroll">
      <header class="app-header">
        <div class="location-title">${icon('pin')}<h2>青岛</h2>${icon('down')}<span class="city-tag">拼船海钓</span></div>
        <button type="button" class="header-icon" data-gps aria-label="GPS 定位当前海域" title="GPS 定位当前海域">${icon('compass')}</button>
      </header>
      <div class="home-body">
        <div class="location-sub">小港码头附近 <span class="gps-dot"></span><span>今日海况 2 级浪，宜出钓</span></div>
        <div class="search-row"><div class="search-text">${icon('search')}<span>搜船、鱼种、海域</span></div><div class="date-box"><span>10月25日</span><b>周六 ${icon('down')}</b></div></div>
        <section class="dual-entry" aria-label="按出钓类型选择">
          <button type="button" class="entry entry-first" data-full-screen="1"><span class="entry-icon">${icon('rod')}</span><h3>第一次海钓</h3><p>体验班 · 全包空手来</p><span class="entry-arrow">${icon('arrow')}</span></button>
          <button type="button" class="entry entry-pro" data-full-screen="1"><span class="entry-icon">${icon('boat')}</span><h3>钓友拼船</h3><p>按鱼种拼班出发</p><span class="entry-arrow">${icon('arrow')}</span></button>
        </section>
        <section class="season-section" aria-labelledby="season-title">
          <div class="section-heading"><h3 id="season-title">当季主攻</h3><span>10 月窗口期</span></div>
          <div class="fish-grid">${[['yellow','黄条鰤','当季'],['ribbon','带鱼','夜钓'],['squid','墨鱼','墨鱼季'],['rock','黑头','黑头肥']].map(([t,n,s],i)=>`<button type="button" data-full-screen="6" class="fish-item ${i===0?'fish-featured':''}"><div class="fish-image">${fishArt(t)}</div><b>${n}</b><span>${s}</span></button>`).join('')}</div>
        </section>
        <section class="activities-section" aria-labelledby="activities-title">
          <div class="section-heading"><h3 id="activities-title">周末，拼一船好时光</h3><span>青岛出发</span></div>
          <article class="activity-card">
            <button type="button" class="activity-image" data-open-detail aria-label="查看海丰号黄条鰤专班活动详情"><img src="assets/fishing-boat-concept-v1.png" alt="白色休闲钓鱼船在海面上航行的概念示意图" /><span class="photo-tag">专业拼船</span><span class="photo-note">船图示意</span><span class="photo-time">${icon('clock')} 周六 05:30–13:30</span></button>
            <div class="activity-content">
              <div class="activity-title"><h4>海丰号 <span>· 沙子口出港</span></h4>${price(500)}</div>
              <p class="target-fish">主攻 黄条鰤 / 鲈鱼</p>
              <div class="card-reputation"><span>${icon('star')}<b>4.9</b> 船长口碑</span><span>空军率 <b>8%</b></span></div>
              <div class="group-status"><div><span>已订 <b>10</b>/12</span><strong>差 2 人成行</strong></div>${meter(83.33)}<p><span class="tiny-dot"></span>尾角位可选<button type="button" data-open-detail>查看活动 ${icon('chevron')}</button></p></div>
            </div>
          </article>
          <article class="activity-card compact-card"><div class="compact-content"><span class="experience-label">体验班</span><div class="activity-title"><h4>蓝鲸号 <span>· 小港出港</span></h4>${price(299)}</div><p class="target-fish">周六 08:00–12:00 · 近岸平稳 · 亲子友好</p><div class="compact-progress"><span>已订 <b>7</b>/12</span><span>装备全包 · 渔获可带走</span></div>${meter(58.33)}</div></article>
        </section>
        <p class="app-sample-note">视觉评审样例 · 非真实班次与实时海况</p>
      </div>
    </div>${nav()}
  </div>`;
}

function detailScreen() {
  return `<div class="app-page detail-page">
    <div class="app-scroll">
      <header class="detail-header"><button type="button" data-open-home aria-label="返回首页">${icon('back')}</button><span>活动详情</span><span class="detail-header-label">专业拼船</span></header>
      <div class="detail-cover"><img src="assets/fishing-boat-concept-v1.png" alt="海丰号船只图片的概念占位示意"/><span class="cover-label">海丰号 · 船图示意</span></div>
      <div class="detail-body">
        <section class="trip-overview"><span class="trip-overline">海丰号 / 专业拼船</span><div class="trip-heading"><h2>黄条鰤专班</h2><div>${price(500)}<small>船位费</small></div></div><p class="trip-time">${icon('calendar')} 周六 05:30 沙子口集合 <span>·</span> 13:30 返港</p></section>
        <section class="captain-card" aria-labelledby="captain-title"><div class="captain-heading"><div class="captain-avatar">刘<span>船长</span></div><div><h3 id="captain-title">刘长河 <small>船长</small></h3><p>出海 212 趟</p></div><div class="reputation-score">${icon('star')}<b>4.9</b><span>船长口碑</span></div></div><div class="captain-stats"><span>空军率 <b>8%</b></span><span>复订率 <b>61%</b></span><span>${icon('shield')} 评价绑定真实订单</span></div></section>
        <section class="sea-card" aria-labelledby="sea-title"><div class="section-heading"><h3 id="sea-title">当日海况</h3><div class="fishing-score"><span>出钓指数</span><b>86</b><span>适宜</span></div></div><div class="sea-stats"><div>${icon('wind')}<b>3 <small>级</small></b><span>风力</span></div><div>${icon('wave')}<b>0.6 <small>m</small></b><span>浪高</span></div><div>${icon('temp')}<b>19.8 <small>℃</small></b><span>水温</span></div><div>${icon('tide')}<b class="tide-text">活汛大潮</b><span>潮汛</span></div></div></section>
        <section class="rig-card" aria-labelledby="rig-title"><div class="section-heading"><h3 id="rig-title">钓组配置</h3><span class="required-label">船长必填</span></div><dl><div><dt>饵料</dt><dd>活虾 500g/人 <span>船长提供</span></dd></div><div><dt>主线 / 前导</dt><dd>PE 2.0 <i>·</i> 碳线 6 号</dd></div><div><dt>铅坠</dt><dd>水滴坠 100–150g <small>（随潮）</small></dd></div></dl></section>
        <section class="boat-card" aria-labelledby="boat-title"><div class="section-heading"><h3 id="boat-title">船况与成团</h3><span class="formed-status">${icon('check')} 已达最低成行</span></div><div class="boat-stats"><div><b>13<small>米</small></b><span>船长</span></div><div><b>12<small>个</small></b><span>钓位</span></div><div><b>1.8<small>m</small></b><span>间距 · 舒适</span></div></div><p class="boat-features">厕所 <i>·</i> 船舱 <i>·</i> 活鱼舱 <i>·</i> 鱼探</p><div class="detail-group"><span>已订 <b>10</b>/12</span><strong>还差 2 位满员</strong></div>${meter(83.33)}</section>
        <p class="app-sample-note">视觉评审样例 · 海况与口碑数据均为占位</p>
      </div>
    </div>
    <div class="booking-bar"><div><span>每位船位费</span>${price(500)}<small>保险下一步单独购买</small></div><button type="button" data-book>选钓位 ${icon('arrow')}</button></div>
    ${nav()}
  </div>`;
}
/* B 深海高级视觉小样：仅包含首页与活动详情两屏。 */
const nav = () => `<nav class="app-tabs" aria-label="App 导航">${[['home','首页'],['compass','发现'],['order','订单'],['user','我的']].map(([name,label],i)=>`<button type="button" class="${i===0?'active':''}" ${i===0?'data-open-home':'data-explain="本轮仅展示首页与活动详情两屏。"'}>${icon(name)}<span>${label}</span>${i===0?'<i></i>':''}</button>`).join('')}</nav>`;
const direction = {label:'深海高级',tag:'DEEP / PRECISE / CONFIDENT',description:'沉静、专注的深海仪表感。为熟悉海钓的钓友，突出参数、口碑与出航确定性。',tone:'墨海黑 × 冰川青 × 暖铜金',colors:['#101f27','#77cbd0','#e6b67a','#e9ece7'],traits:[['01','专业的秩序感','更利落的区块，数字成为阅读锚点。'],['02','克制的深色层次','海况与成团状态用色精准区分。'],['03','温暖的交易重点','暖铜价格与按钮，操作清楚可见。']],font:'无衬线正文 / 等宽数字',shadow:'低对比描边 / 更小圆角 / 哑光层次'};
const params = new URLSearchParams(location.search);
const state = {screen:params.get('screen')==='detail'?'detail':'home',appView:params.get('view')==='app'};

function render(){
  document.body.dataset.direction='b';
  document.body.dataset.screen=state.screen;
  document.body.classList.toggle('app-only',state.appView);
  document.querySelectorAll('[data-screen]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.screen===state.screen)));
  document.getElementById('direction-notes').innerHTML=`<span class="direction-letter">B</span><p class="direction-kicker">${direction.tag}</p><h2>${direction.label}</h2><p class="direction-description">${direction.description}</p><div class="color-swatches">${direction.colors.map(color=>`<span style="--swatch:${color}" title="${color}"></span>`).join('')}</div><p class="color-caption">${direction.tone}</p><ol class="direction-traits">${direction.traits.map(([num,title,description])=>`<li><span>${num}</span><div><h3>${title}</h3><p>${description}</p></div></li>`).join('')}</ol><div class="foundation-notes"><b>视觉基础</b><p>${direction.font}<br/>${direction.shadow}</p></div><div class="sample-disclosure">单一方向 · 首页与详情两屏<br/>船图为视觉占位；鱼种为示意插画。</div>`;
  document.getElementById('screens').innerHTML=['home','detail'].map((screen,index)=>`<article class="screen-unit" data-page="${screen}"><div class="screen-caption"><span>B${index+1} <b>${index===0?'客户端首页':'活动详情'}</b></span><a href="?screen=${screen}&view=app" target="_blank" rel="noopener" aria-label="独立打开${index===0?'首页':'活动详情'}小样">独立预览 ↗</a></div><div class="phone-frame theme-b">${status()}${index===0?homeScreen():detailScreen()}<div class="home-indicator" aria-hidden="true"></div></div></article>`).join('');
  const url=new URL(location.href);url.searchParams.set('screen',state.screen);url.searchParams.delete('style');
  if(state.appView) url.searchParams.set('view','app'); else url.searchParams.delete('view');
  history.replaceState(null,'',url);
  document.title=`B 深海高级 · ${state.screen==='home'?'首页':'活动详情'} | 拼船海钓`;
}

document.addEventListener('click',event=>{
  const button=event.target.closest('button');
  if(!button) return;
  if(button.hasAttribute('data-gps')){
    document.getElementById('dialog-title').textContent='GPS 定位演示';
    document.getElementById('dialog-message').textContent='正式版将在你授权后读取当前位置，并匹配最近海域、码头与海况。当前 HTML 预览不会请求定位权限，也不读取真实 GPS。';
    const constraint=document.getElementById('dialog-constraint');
    if(constraint){constraint.textContent='青岛 · 小港码头附近为设计样例';constraint.hidden=false;}
    document.getElementById('preview-dialog').showModal();
    return;
  }
  if(button.dataset.screen){state.screen=button.dataset.screen;render();return;}
  if(button.hasAttribute('data-open-detail')){state.screen='detail';render();return;}
  if(button.hasAttribute('data-open-home')){state.screen='home';render();return;}
  if(button.hasAttribute('data-full-screen')){
    document.getElementById('dialog-title').textContent='本轮小样范围';
    document.getElementById('dialog-message').textContent='首页与活动详情之外的页面将在后续阶段按产品正本推进。';
    document.getElementById('dialog-constraint').hidden=true;
    document.getElementById('preview-dialog').showModal();
    return;
  }
  if(button.hasAttribute('data-book')||button.dataset.explain){
    document.getElementById('dialog-title').textContent=button.dataset.explain?'本轮小样范围':'下一步：选钓位';
    document.getElementById('dialog-message').textContent=button.dataset.explain?'当前仅展示 B 深海高级首页与活动详情两屏。':'当前展示 B 深海高级首页与活动详情两屏；选位、订单与船长端待后续推进。';
    document.getElementById('dialog-constraint').hidden=false;
    document.getElementById('preview-dialog').showModal();
  }
});
render();
