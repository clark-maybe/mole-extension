/** 从旧版平台能力迁移；仅注入独立任务页签。 */
(function installCompanySearchXhrHook() {
  'use strict';

  var source = '__mantis_company_search_xhr_hook__';
  var marker = '__mantis_company_search_xhr_installed__';
  var pageUrl = new URL(window.location.href);
  var isCrmHost = pageUrl.hostname === 'lxcrm.weiwenjia.com'
    || pageUrl.hostname.endsWith('.lxcrm.weiwenjia.com');
  var isContactMode = pageUrl.searchParams.get('mode') === 'contact';
  if (!isCrmHost || !pageUrl.pathname.startsWith('/soukebox/advanced_search') || isContactMode) return;
  if (window[marker]) return;
  window[marker] = true;

  var apiHost = 'skb.weiwenjia.com';
  var apiPathPattern = /^\/api_skb\/v1\/advanced_search\/?$/;
  var lastResult = null;
  var lastRequestHeaders = {};
  var searchStarted = false;

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

  function getApiUrl(requestUrl) {
    try {
      var url = new URL(String(requestUrl || ''), window.location.href);
      return url.hostname === apiHost && apiPathPattern.test(url.pathname) ? url : null;
    } catch (_) {
      return null;
    }
  }

  function getKeyword(body) {
    try {
      var data = typeof body === 'string' ? JSON.parse(body) : body;
      if (data && typeof data.keyword === 'string') return data.keyword;
      var values = data && data.condition && Array.isArray(data.condition.cv) ? data.condition.cv : [];
      for (var i = 0; i < values.length; i += 1) {
        if (values[i] && values[i].cn === 'entName' && Array.isArray(values[i].cv)) return String(values[i].cv[0] || '');
      }
    } catch (_) {
      // 页面可能在请求体为空时先发起探测请求。
    }
    return pageUrl.searchParams.get('keyword') || pageUrl.searchParams.get('entName') || '';
  }

  function normalizeRequestBody(body) {
    var keyword = (pageUrl.searchParams.get('keyword') || getKeyword(body)).trim();
    return keyword ? buildAdvancedSearchBody(keyword) : body;
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

  function captureHeaders(headers) {
    var values = headersToObject(headers);
    Object.keys(values).forEach(function (name) {
      if (values[name]) lastRequestHeaders[name] = values[name];
    });
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
      'content-type',
      'crm_platform_type',
      'distinct_id',
      'platform_type',
      'project_name',
    ].forEach(function (name) {
      if (sourceHeaders[name]) result[name] = sourceHeaders[name];
    });
    if (!result.accept) result.accept = 'application/json, text/plain, */*';
    if (!result['content-type']) result['content-type'] = 'application/json;charset=UTF-8';
    return result;
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

  function parseResponse(xhr) {
    if (xhr.responseType === 'json' && xhr.response && typeof xhr.response === 'object') return xhr.response;
    if (typeof xhr.response === 'string' && xhr.response) return JSON.parse(xhr.response);
    if (typeof xhr.responseText === 'string' && xhr.responseText) return JSON.parse(xhr.responseText);
    throw new Error('企业搜索 XHR 响应为空');
  }

  function publishResponse(payload, error, keyword) {
    var message = { source: source, type: 'result', keyword: keyword || '' };
    if (error) message.error = String(error);
    else message.payload = payload;
    lastResult = message;
    window.postMessage(message, '*');
  }

  async function runSearch(keyword, requestHeaders) {
    if (searchStarted) return;
    searchStarted = true;
    var normalizedKeyword = String(keyword || '').trim();
    if (!normalizedKeyword) {
      publishResponse(null, '企业搜索缺少企业名称', normalizedKeyword);
      return;
    }
    await waitForRequestHeaders(15_000);
    var headers = businessHeaders(requestHeaders || lastRequestHeaders);
    if (!hasRequiredHeaders(headers)) headers = businessHeaders(lastRequestHeaders);
    if (!hasRequiredHeaders(headers)) {
      publishResponse(null, '企业搜索未捕获到励销云登录请求头', normalizedKeyword);
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
      if (!response.ok || payload.success === false) throw new Error(payload.message || payload.msg || ('企业搜索接口 HTTP ' + response.status));
      publishResponse(payload, '', normalizedKeyword);
    } catch (error) {
      publishResponse(null, error, normalizedKeyword);
    }
  }

  window.addEventListener('message', function (event) {
    if (event.source !== window) return;
    var data = event.data;
    if (!data || data.source !== source) return;
    if (data.type === 'ready' && lastResult) {
      window.postMessage(lastResult, '*');
      return;
    }
    if (data.type === 'execute') void runSearch(data.keyword || pageUrl.searchParams.get('keyword'), lastRequestHeaders);
  });

  var originalOpen = XMLHttpRequest.prototype.open;
  var originalSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;
  var originalSend = XMLHttpRequest.prototype.send;
  var urlKey = '__mantis_company_search_url__';
  var bodyKey = '__mantis_company_search_body__';
  var headersKey = '__mantis_company_search_headers__';

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

  XMLHttpRequest.prototype.send = function (body) {
    var xhr = this;
    var normalizedBody = getApiUrl(xhr[urlKey]) ? normalizeRequestBody(body) : body;
    xhr[bodyKey] = normalizedBody;
    captureHeaders(xhr[headersKey]);
    var url = getApiUrl(xhr[urlKey]);
    if (url) {
      var reported = false;
      var report = function () {
        if (reported || xhr.readyState !== 4) return;
        reported = true;
        try {
          if (xhr.status < 200 || xhr.status >= 300) throw new Error('企业搜索 XHR HTTP 状态异常: ' + xhr.status);
          publishResponse(parseResponse(xhr), '', getKeyword(xhr[bodyKey]));
        } catch (error) {
          publishResponse(null, error, getKeyword(xhr[bodyKey]));
        }
      };
      xhr.addEventListener('readystatechange', report);
      xhr.addEventListener('load', report, { once: true });
      xhr.addEventListener('loadend', report, { once: true });
    }
    return originalSend.call(this, normalizedBody);
  };

  var originalFetch = window.fetch;
  window.fetch = async function (input, init) {
    captureHeaders(init && init.headers);
    if (!init && input && input.headers) captureHeaders(input.headers);
    var inputUrl = typeof input === 'string' ? input : input && input.url;
    var normalizedBody = getApiUrl(inputUrl) ? normalizeRequestBody(init && init.body) : init && init.body;
    var requestInit = Object.assign({}, init || {});
    if (getApiUrl(inputUrl) && typeof normalizedBody === 'string') {
      requestInit.method = 'POST';
      requestInit.body = normalizedBody;
    }
    var response = await originalFetch.call(this, input, requestInit);
    var requestUrl = typeof input === 'string' ? input : input && typeof input.url === 'string' ? input.url : String(input || '');
    var url = getApiUrl(requestUrl);
    if (!url) return response;
    try {
      publishResponse(await response.clone().json(), '', getKeyword(normalizedBody));
    } catch (error) {
      publishResponse(null, error, getKeyword(normalizedBody));
    }
    return response;
  };
})();
