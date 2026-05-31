(function () {
  var DOCS = [
    { href: 'index.html', title: '文档中心', category: '入门', summary: '学习路径、接口地图和源码依据' },
    { href: 'quick-start.html', title: '从 0 到 1 快速上手', category: '入门', summary: '首次启动、菜单地图和主流程' },
    { href: 'accounts-oauth.html', title: '邮箱账户与 OAuth2', category: '邮箱运营', summary: 'Gmail、Outlook、IMAP/SMTP、验证和错误状态' },
    { href: 'sync-mailbox.html', title: '同步、邮件管理与搜索', category: '邮箱运营', summary: '同步配置、邮件读取、附件和监控' },
    { href: 'pickup-extractor.html', title: '取件与取件模板 V2', category: '邮箱运营', summary: '验证码等待、模板结构和输出格式' },
    { href: 'triggers-actions.html', title: '触发器、表达式与动作插件', category: '自动化', summary: 'EmailTriggerV2、条件树、动作链和日志' },
    { href: 'interceptors-templates.html', title: '拦截器与模板复用', category: '自动化', summary: 'before/after 拦截器、策略和模板治理' },
    { href: 'business-account-automation.html', title: '基于业务账户的自动化教程', category: '自动化', summary: '邮箱领取、验证码取件和业务资料回写' },
    { href: 'ai-business-proxy.html', title: 'AI、业务资料、标签与代理池', category: '高级能力', summary: 'AI 配置、业务账户、标签和代理组合' },
    { href: 'recipes-troubleshooting.html', title: '组合场景与故障排查', category: '高级能力', summary: '验证码、通知、AI 分流和上线清单' },
    { href: 'api-reference.html', title: 'API 接入总览', category: 'API 与运维', summary: '登录、领域接口、权限和 WebSocket' },
    { href: 'deployment-ops.html', title: '部署与生产运维', category: 'API 与运维', summary: 'Docker、Compose、环境变量和备份' }
  ];

  function createElement(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (key) {
        if (key === 'className') node.className = attrs[key];
        else if (key === 'text') node.textContent = attrs[key];
        else node.setAttribute(key, attrs[key]);
      });
    }
    for (var i = 2; i < arguments.length; i += 1) {
      var child = arguments[i];
      if (child == null) continue;
      if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  function currentFileName() {
    var last = window.location.pathname.split('/').pop();
    return last || 'index.html';
  }

  function currentDoc() {
    var file = currentFileName();
    return DOCS.find(function (doc) { return doc.href === file; }) || DOCS[0];
  }

  function groupDocs() {
    var groups = [];
    DOCS.forEach(function (doc) {
      var group = groups.find(function (item) { return item.category === doc.category; });
      if (!group) {
        group = { category: doc.category, docs: [] };
        groups.push(group);
      }
      group.docs.push(doc);
    });
    return groups;
  }

  function activateTabs(root, nextButton) {
    var buttons = Array.prototype.slice.call(root.querySelectorAll('[role="tab"]'));
    var panels = Array.prototype.slice.call(root.querySelectorAll('[role="tabpanel"]'));
    var target = nextButton.getAttribute('aria-controls');

    buttons.forEach(function (button) {
      button.setAttribute('aria-selected', button === nextButton ? 'true' : 'false');
    });

    panels.forEach(function (panel) {
      panel.classList.toggle('active', panel.id === target);
    });
  }

  function setupTabs() {
    document.addEventListener('click', function (event) {
      var button = event.target.closest('[role="tab"]');
      if (!button) return;
      var root = button.closest('[data-tabs]');
      if (!root) return;
      activateTabs(root, button);
    });

    document.querySelectorAll('[data-tabs]').forEach(function (root) {
      var selected = root.querySelector('[role="tab"][aria-selected="true"]') || root.querySelector('[role="tab"]');
      if (selected) activateTabs(root, selected);
    });
  }

  function setupSideCollapse(layout, side, key, expandedLabel, collapsedLabel) {
    var button = side.querySelector('.doc-side-toggle');
    if (!button) return;

    function render() {
      var collapsed = side.classList.contains('collapsed');
      layout.classList.toggle(key + '-collapsed', collapsed);
      button.setAttribute('aria-expanded', String(!collapsed));
      button.setAttribute('aria-label', collapsed ? collapsedLabel : expandedLabel);
      button.title = collapsed ? collapsedLabel : expandedLabel;
      button.textContent = collapsed ? (key === 'left' ? '>' : '<') : (key === 'left' ? '<' : '>');
    }

    button.addEventListener('click', function () {
      side.classList.toggle('collapsed');
      render();
    });
    render();
  }

  function buildLeftNav(doc) {
    var shell = createElement('div', { className: 'doc-side-shell' });
    var titleBlock = createElement('div', { className: 'doc-side-titleblock' },
      createElement('p', { className: 'doc-side-kicker', text: 'Mailman Guide' }),
      createElement('h2', { className: 'doc-side-title', text: '接入手册' })
    );
    var actions = createElement('div', { className: 'doc-side-actions' },
      titleBlock,
      createElement('button', { className: 'doc-side-toggle', type: 'button', 'aria-label': '折叠左侧目录' })
    );
    var current = createElement('div', { className: 'doc-current' },
      createElement('strong', { text: doc.title }),
      createElement('span', { text: doc.summary })
    );
    var capability = createElement('a', {
      className: 'doc-capability-link',
      href: './index.html#coverage'
    },
      createElement('span', { text: '45' }),
      createElement('strong', { text: '项能力路线图' })
    );
    var nav = createElement('nav', { className: 'doc-nav', 'aria-label': '文档目录' });

    groupDocs().forEach(function (group) {
      var details = createElement('details', { className: 'nav-group' });
      if (group.category === doc.category || currentFileName() === 'index.html') details.open = true;
      details.appendChild(createElement('summary', { text: group.category }));
      var links = createElement('div', { className: 'nav-group-links' });
      group.docs.forEach(function (item) {
        var link = createElement('a', {
          className: 'nav-link' + (item.href === currentFileName() ? ' active' : ''),
          href: './' + item.href,
          text: item.title
        });
        links.appendChild(link);
      });
      details.appendChild(links);
      nav.appendChild(details);
    });

    shell.appendChild(actions);
    shell.appendChild(createElement('div', { className: 'doc-side-content' }, current, capability, nav));
    return shell;
  }

  function slugify(text, index) {
    var slug = text.trim().toLowerCase()
      .replace(/[^\w\u4e00-\u9fa5]+/g, '-')
      .replace(/^-+|-+$/g, '');
    return slug || ('section-' + index);
  }

  function collectHeadings(main) {
    return Array.prototype.slice.call(main.querySelectorAll('h2, h3')).filter(function (heading) {
      var text = heading.textContent.trim();
      if (!text) return false;
      if (heading.closest('.hero-art') || heading.closest('.card')) return false;
      return true;
    });
  }

  function targetIdForHeading(heading, index) {
    if (heading.id) return heading.id;
    var section = heading.closest('section[id]');
    if (section && heading.tagName.toLowerCase() === 'h2') return section.id;
    heading.id = slugify(heading.textContent, index);
    return heading.id;
  }

  function buildOutline(main) {
    var shell = createElement('div', { className: 'doc-side-shell' });
    var titleBlock = createElement('div', { className: 'doc-side-titleblock' },
      createElement('p', { className: 'doc-side-kicker', text: 'On This Page' }),
      createElement('h2', { className: 'doc-side-title', text: '页面大纲' })
    );
    var actions = createElement('div', { className: 'doc-side-actions' },
      titleBlock,
      createElement('button', { className: 'doc-side-toggle', type: 'button', 'aria-label': '折叠右侧大纲' })
    );
    var headings = collectHeadings(main);
    var content = createElement('div', { className: 'doc-side-content' });
    var panel = createElement('details', { className: 'outline-panel', open: 'open' });
    panel.appendChild(createElement('summary', { text: '本页目录' }));
    var links = createElement('div', { className: 'outline-links' });

    if (headings.length === 0) {
      links.appendChild(createElement('span', { className: 'outline-link', text: '暂无二级标题' }));
    } else {
      headings.forEach(function (heading, index) {
        var id = targetIdForHeading(heading, index + 1);
        links.appendChild(createElement('a', {
          className: 'outline-link ' + heading.tagName.toLowerCase(),
          href: '#' + encodeURIComponent(id),
          text: heading.textContent.trim()
        }));
      });
    }

    panel.appendChild(links);
    content.appendChild(panel);
    shell.appendChild(actions);
    shell.appendChild(content);
    return { shell: shell, headings: headings };
  }

  function setupScrollSpy(headings) {
    var links = Array.prototype.slice.call(document.querySelectorAll('.outline-link[href^="#"]'));
    if (!headings.length || !links.length) return;

    function updateActive() {
      var active = headings[0];
      headings.forEach(function (heading) {
        if (heading.getBoundingClientRect().top <= 118) active = heading;
      });
      var activeId = targetIdForHeading(active, headings.indexOf(active) + 1);
      links.forEach(function (link) {
        link.classList.toggle('active', decodeURIComponent(link.hash.slice(1)) === activeId);
      });
    }

    updateActive();
    window.addEventListener('scroll', updateActive, { passive: true });
  }

  function setupProgress() {
    var bar = document.querySelector('.doc-progress span');
    if (!bar) return;

    function update() {
      var root = document.documentElement;
      var max = root.scrollHeight - root.clientHeight;
      var value = max > 0 ? (root.scrollTop / max) * 100 : 0;
      bar.style.width = value + '%';
    }

    update();
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
  }

  function setupCodeCopy() {
    document.querySelectorAll('pre').forEach(function (pre) {
      if (pre.querySelector('.copy-code')) return;
      var code = pre.querySelector('code');
      if (!code) return;
      var button = createElement('button', { className: 'copy-code', type: 'button', text: '复制' });
      button.addEventListener('click', function () {
        var text = code.innerText;
        var done = function () {
          button.textContent = '已复制';
          window.setTimeout(function () { button.textContent = '复制'; }, 1200);
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(done).catch(done);
        } else {
          done();
        }
      });
      pre.appendChild(button);
    });
  }

  function setupShell() {
    var main = document.querySelector('main.page');
    if (!main || document.querySelector('.doc-layout')) return;

    var doc = currentDoc();
    var progress = createElement('div', { className: 'doc-progress' }, createElement('span'));
    var layout = createElement('div', { className: 'doc-layout' });
    var left = createElement('aside', { className: 'doc-side doc-left', id: 'doc-left-nav' });
    var center = createElement('div', { className: 'doc-main' });
    var right = createElement('aside', { className: 'doc-side doc-right', id: 'doc-outline' });

    left.appendChild(buildLeftNav(doc));
    var outline = buildOutline(main);
    right.appendChild(outline.shell);

    document.body.insertBefore(progress, main);
    document.body.insertBefore(layout, main);
    center.appendChild(main);
    layout.appendChild(left);
    layout.appendChild(center);
    layout.appendChild(right);

    if (window.innerWidth <= 1100) {
      left.classList.add('collapsed');
      right.classList.add('collapsed');
    }

    setupSideCollapse(layout, left, 'left', '折叠左侧目录', '展开左侧目录');
    setupSideCollapse(layout, right, 'right', '折叠右侧大纲', '展开右侧大纲');
    setupScrollSpy(outline.headings);
    setupProgress();
  }

  document.addEventListener('DOMContentLoaded', function () {
    setupTabs();
    setupShell();
    setupCodeCopy();
  });
})();
