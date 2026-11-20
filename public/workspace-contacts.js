/** 从旧版平台能力迁移；仅注入独立任务页签。 */
(function installCompanyContactXhrHook() {
  'use strict';

  var source = '__mantis_company_contact_xhr_hook__';
  var marker = '__mantis_company_contact_xhr_installed__';
  var pageUrl = new URL(window.location.href);
  var isCrmHost = pageUrl.hostname === 'lxcrm.weiwenjia.com'
    || pageUrl.hostname.endsWith('.lxcrm.weiwenjia.com');
  if (!isCrmHost || !pageUrl.pathname.startsWith('/soukebox/advanced_search')
    || pageUrl.searchParams.get('mode') !== 'contact' || window[marker]) return;
  window[marker] = true;

  var apiHost = 'skb.weiwenjia.com';
  var searchPathPattern = /^\/api_skb\/v1\/advanced_search\/?$/;
  var contactsPath = '/api_skb/v1/clue/contacts';
  var pid = pageUrl.searchParams.get('pid') || '';
  var entName = pageUrl.searchParams.get('entName') || '';
  var contactStarted = false;
  var searchStarted = false;
  var lastRequestHeaders = {};
  var lastResult = null;

  function buildAdvancedSearchBody(keyword) {
    return JSON.stringify({
      condition: {
        cn: 'composite',
        cr: 'MUST',
        cv: [
          { cn: 'hasMobile', cr: 'IS', cv: true, id: '1657277694935115' },
          { cn: 'entStatus', cr: 'IN', cv: ['1'], id: '1657277706893117' },
          { cn: 'entName', cr: 'IN', cv: [keyword], id: 'b8e78e91-c527-4ae4-b8df-517af7ebc73a' },
        ],
      },
      hasSyncClue: 0,
      hasSyncRobot: 0,
      hasSyncDx: 0,
      hasSyncIsys: 0,
      hasUnfolded: 0,
      sortBy: 0,
      syncRobotRangeDate: [],
      syncDxRangeDate: [],
      syncIsysRangeDate: [],
      syncCrmRangeDate: [],
      syncRobotRangeDateRelation: 0,
      syncDxRangeDateRelation: 0,
      syncIsysRangeDateRelation: 0,
      syncCrmRangeDateRelation: 0,
      page: 1,
      pagesize: 10,
      userClick: 1,
      templateType: 0,
      templateName: '',
      templateUuid: '',
    });
  }

  function headersToObject(headers) {
    var result = {};
    if (!headers) return result;
    if (typeof headers.forEach === 'function') {
      headers.forEach(function (value, name) { result[String(name).toLowerCase()] = String(value); });
      return result;
    }
    if (Array.isArray(headers)) {
      headers.forEach(function (entry) {
        if (Array.isArray(entry) && entry.length >= 2) result[String(entry[0]).toLowerCase()] = String(entry[1]);
      });
      return result;
    }
    Object.keys(headers).forEach(function (name) { result[String(name).toLowerCase()] = String(headers[name]); });
    return result;
  }

  function businessHeaders(headers) {
    var sourceHeaders = headersToObject(headers);
    var result = {};
    [
      'accept',
      'accept-language',
      'app_token',
      'authorization',
      'brand',
      'crm_platform_type',
      'distinct_id',
      'platform_type',
      'project_name',
    ].forEach(function (name) {
      if (sourceHeaders[name]) result[name] = sourceHeaders[name];
    });
    if (!result.accept) result.accept = 'application/json, text/plain, */*';
    return result;
  }

  function advancedHeaders(headers) {
    var result = businessHeaders(headers);
    result['content-type'] = 'application/json;charset=UTF-8';
    return result;
  }

  function captureHeaders(headers) {
    var values = headersToObject(headers);
    Object.keys(values).forEach(function (name) {
      if (values[name]) lastRequestHeaders[name] = values[name];
    });
  }

  function hasRequiredHeaders(headers) {
    var values = headersToObject(headers);
    return Boolean(values.authorization && values.app_token);
  }

  function waitForRequestHeaders(timeoutMs) {
    if (hasRequiredHeaders(lastRequestHeaders)) return Promise.resolve();
    return new Promise(function (resolve) {
      var startedAt = Date.now();
      var timer = window.setInterval(function () {
        if (hasRequiredHeaders(lastRequestHeaders) || Date.now() - startedAt >= timeoutMs) {
          window.clearInterval(timer);
          resolve();
        }
      }, 100);
    });
  }

  function getKeyword(body) {
    try {
      var data = typeof body === 'string' ? JSON.parse(body) : body;
      var values = data && data.condition && Array.isArray(data.condition.cv) ? data.condition.cv : [];
      for (var i = 0; i < values.length; i += 1) {
        if (values[i] && values[i].cn === 'entName' && Array.isArray(values[i].cv)) return String(values[i].cv[0] || '');
      }
    } catch (_) {
      // 页面探测请求可能没有可解析的请求体。
    }
    return entName;
  }

  function normalizeRequestBody(body) {
    var keyword = getKeyword(body).trim();
    return keyword ? buildAdvancedSearchBody(keyword) : body;
  }

  function extractPhone(value) {
    var text = typeof value === 'string' ? value.trim() : '';
    var match = text.match(/\+?\d[\d\s()-]{5,}\d/);
    return match ? match[0].replace(/[\s()-]/g, '') : '';
  }

  function parseDetails(payload) {
    var contacts = payload && payload.data && Array.isArray(payload.data.contacts) ? payload.data.contacts : [];
    return contacts.map(function (contact) {
      if (!contact || typeof contact !== 'object') return null;
      var sources = Array.isArray(contact.sourcesContent)
        ? contact.sourcesContent.filter(function (value) { return typeof value === 'string' && value.trim(); })
        : Array.isArray(contact.sources)
          ? contact.sources.map(function (source) {
            return source && typeof source === 'object' && typeof source.sourceName === 'string'
              ? source.sourceName.trim()
              : '';
          }).filter(Boolean)
          : [];
      return {
        content: typeof contact.content === 'string' ? contact.content.trim() : '',
        type: contact.type == null ? '' : String(contact.type),
        contactName: typeof contact.contact === 'string' ? contact.contact.trim() : '',
        department: typeof contact.departmentContent === 'string' ? contact.departmentContent.trim() : '',
        position: typeof contact.position === 'string' ? contact.position.trim() : typeof contact.positionContent === 'string' ? contact.positionContent.trim() : '',
        area: typeof contact.numArea === 'string' ? contact.numArea.trim() : '',
        carrier: typeof contact.carrier === 'string' ? contact.carrier.trim() : '',
        status: contact.rawNumStatus == null ? (contact.numStatus == null ? '' : String(contact.numStatus)) : String(contact.rawNumStatus),
        valid: typeof contact.valid === 'boolean' ? contact.valid : undefined,
        sources: Array.from(new Set(sources)),
      };
    }).filter(function (contact) {
      return contact && (contact.content || contact.contactName || contact.position || contact.sources.length > 0);
    });
  }

  function pickPhone(details) {
    for (var i = 0; i < details.length; i += 1) {
      if (Number(details[i].type) !== 1 && Number(details[i].type) !== 2) continue;
      var phone = extractPhone(details[i].content);
      if (phone) return phone;
    }
    return '';
  }

  function publish(result, error) {
    var message = { source: source, type: 'result', pid: pid, entName: entName };
    if (error) message.error = String(error);
    else {
      message.phone = result.phone;
      message.details = result.details;
      message.raw = result.raw;
    }
    lastResult = message;
    window.postMessage(message, '*');
  }

  window.addEventListener('message', function (event) {
    if (event.source !== window) return;
    var data = event.data;
    if (!data || data.source !== source) return;
    if (data.type === 'ready' && lastResult) {
      window.postMessage(lastResult, '*');
      return;
    }
    if (data.type === 'execute') void runAdvancedSearch(data.keyword || entName, lastRequestHeaders);
  });

  async function fetchContacts(requestHeaders) {
    if (contactStarted) return;
    contactStarted = true;
    if (!pid) {
      publish(null, '联系方式查询缺少企业 ID');
      return;
    }
    var url = new URL('https://' + apiHost + contactsPath);
    url.searchParams.set('pid', pid);
    url.searchParams.set('source', 'search_list');
    if (entName) url.searchParams.set('entName', entName);
    try {
      var response = await originalFetch.call(window, url.toString(), {
        method: 'GET',
        headers: businessHeaders(requestHeaders),
        credentials: 'include',
        mode: 'cors',
      });
      var payload = await response.json();
      if (!response.ok || payload.success === false) throw new Error('联系方式接口 HTTP ' + response.status);
      var details = parseDetails(payload);
      publish({ phone: pickPhone(details), details: details, raw: payload }, '');
    } catch (error) {
      publish(null, error);
    }
  }

  async function runAdvancedSearch(keyword, requestHeaders) {
    if (searchStarted) return;
    searchStarted = true;
    var normalizedKeyword = String(keyword || entName).trim();
    if (!normalizedKeyword) {
      publish(null, '联系方式查询缺少企业名称');
      return;
    }
    await waitForRequestHeaders(15000);
    var headers = advancedHeaders(requestHeaders || lastRequestHeaders);
    if (!hasRequiredHeaders(headers)) headers = advancedHeaders(lastRequestHeaders);
    if (!hasRequiredHeaders(headers)) {
      publish(null, '联系方式查询未捕获到励销云登录请求头');
      return;
    }
    try {
      var response = await originalFetch.call(window, 'https://' + apiHost + '/api_skb/v1/advanced_search', {
        method: 'POST',
        headers: headers,
        body: buildAdvancedSearchBody(normalizedKeyword),
        credentials: 'include',
        mode: 'cors',
      });
      var payload = await response.clone().json();
      if (!response.ok || payload.success === false) throw new Error('企业搜索接口 HTTP ' + response.status);
      await fetchContacts(headers);
    } catch (error) {
      publish(null, error);
    }
  }

  function matchesSearch(value) {
    try { var url = new URL(value, location.href); return url.hostname === apiHost && searchPathPattern.test(url.pathname); } catch (_) { return false; }
  }
  var originalFetch = window.fetch;
  window.fetch = async function (input, init) {
    captureHeaders(init && init.headers);
    if (!init && input && input.headers) captureHeaders(input.headers);
    var inputUrl = typeof input === 'string' ? input : input && input.url;
    var normalizedBody = matchesSearch(inputUrl) ? normalizeRequestBody(init && init.body) : init && init.body;
    var requestInit = Object.assign({}, init || {});
    if (matchesSearch(inputUrl) && typeof normalizedBody === 'string') {
      requestInit.method = 'POST';
      requestInit.body = normalizedBody;
    }
    var response = await originalFetch.call(this, input, requestInit);
    var requestUrl = typeof input === 'string' ? input : input && typeof input.url === 'string' ? input.url : String(input || '');
    var requestHeaders = init && init.headers;
    if (!requestHeaders && input && input.headers) requestHeaders = input.headers;
    try {
      var url = new URL(requestUrl, window.location.href);
      if (url.hostname === apiHost && searchPathPattern.test(url.pathname)) void fetchContacts(requestHeaders);
    } catch (_) {
      // 忽略无法解析的页面请求地址。
    }
    return response;
  };

  var originalOpen = XMLHttpRequest.prototype.open;
  var originalSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;
  var originalSend = XMLHttpRequest.prototype.send;
  var urlKey = '__mantis_company_contact_url__';
  var headersKey = '__mantis_company_contact_headers__';
  XMLHttpRequest.prototype.open = function (method, requestUrl) {
    this[urlKey] = String(requestUrl || '');
    this[headersKey] = {};
    return originalOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
    if (!this[headersKey]) this[headersKey] = {};
    this[headersKey][String(name).toLowerCase()] = String(value);
    return originalSetRequestHeader.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function () {
    var xhr = this;
    var normalizedBody = matchesSearch(xhr[urlKey]) ? normalizeRequestBody(arguments[0]) : arguments[0];
    captureHeaders(xhr[headersKey]);
    try {
      var url = new URL(xhr[urlKey], window.location.href);
      if (url.hostname === apiHost && searchPathPattern.test(url.pathname)) void fetchContacts(xhr[headersKey]);
    } catch (_) {
      // 忽略无法解析的页面请求地址。
    }
    return originalSend.call(this, normalizedBody);
  };
})();
