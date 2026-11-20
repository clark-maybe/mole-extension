/** 从旧版平台能力迁移；仅注入独立任务页签。 */
(function installFengniaoyunCompanySearchHook() {
  'use strict';

  var source = '__mantis_fengniaoyun_company_search_xhr_hook__';
  var marker = '__mantis_fengniaoyun_company_search_xhr_installed__';
  var pageUrl = new URL(window.location.href);
  if ((pageUrl.hostname !== 'riskbird.com' && !pageUrl.hostname.endsWith('.riskbird.com'))
    || pageUrl.pathname !== '/search/company' || window[marker]) return;
  window[marker] = true;

  var endpoint = '/riskbird-api/api/v1/companies/search';
  var reported = false;

  function publish(payload, error) {
    if (reported) return;
    reported = true;
    window.postMessage({ source: source, type: 'result', keyword: pageUrl.searchParams.get('keyword') || '', payload: payload, error: error }, '*');
  }

  function search(keyword) {
    var body = JSON.stringify({
      queryType: '1',
      searchKey: keyword,
      pageNo: 1,
      range: 10,
      selectConditionData: JSON.stringify({ status: '1', sort_field: '', keyword_fields: '1' })
    });
    fetch(endpoint, {
      method: 'POST',
      credentials: 'include',
      headers: { accept: 'application/json', 'content-type': 'application/json', 'app-device': 'WEB' },
      body: body
    }).then(function (response) {
      return response.text().then(function (text) {
        var payload;
        try { payload = JSON.parse(text); } catch (_) { throw new Error('风鸟云响应不是有效 JSON'); }
        if (!response.ok) throw new Error('风鸟云企业搜索接口 HTTP ' + response.status);
        publish(payload);
      });
    }).catch(function (error) {
      publish(null, error && error.message ? error.message : String(error));
    });
  }

  window.addEventListener('message', function (event) {
    if (event.source !== window || !event.data || event.data.source !== source) return;
    if (event.data.type === 'execute') {
      var keyword = String(event.data.keyword || '').trim();
      if (!keyword) publish(null, '风鸟云企业搜索缺少关键词');
      else search(keyword);
    }
  });
}());
