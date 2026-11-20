/** 迁移自旧版专用 CRM；验证配置运行时提供，不在代码内保存。 */
(function installCustomerRecordHook() {
  'use strict';

  var source = '__mantis_customer_record_hook__';
  var marker = '__mantis_customer_record_hook_installed__';
  var pageUrl = new URL(window.location.href);
  if (pageUrl.hostname !== 'bdtg.n4.bjmantis.cn'
    && pageUrl.hostname !== 'njtlqc.n4.bjmantis.cn'
    || pageUrl.pathname !== '/mantis/tmk/myCustomer/first'
    || window[marker]) return;
  window[marker] = true;

  var API_PATH = '/mcrm-war/customer/addCustomer.do';
  var DEFAULT_API_ORIGIN = 'https://b2009.n4.bjmantis.cn';
  var MANTIS_VERIFICATION = '';
  var activeConfig = {};
  var COPY_TYPE = 'ADD_CUSTOMER';
  var DEFAULT_MSC_CODE = 'MSC_ZT';
  var BDTG_MSC_CODE = '31b23dc92e284bbc9f6298c70ee65f96';
  var NJTLQC_MSC_CODE = '31b23dc92e284bbc9f6298c70ee65f96';
  var FIELD_ELEVEN_MAX_LENGTH = 240;
  // 临时调试节流：让每条录入请求之间留出时间观察结果。
  var RECORD_BETWEEN_REQUESTS_MS = 2000;
  var running = false;

  function asString(value) {
    return value === null || value === undefined ? '' : String(value);
  }

  function storageValue() {
    for (var i = 0; i < arguments.length; i += 1) {
      var value = window.localStorage.getItem(arguments[i]);
      if (value) return value;
    }
    return '';
  }

  function getApiOrigin() {
    var configured = storageValue('serverName', 'server_name', 'mantisServerName');
    if (!configured) return DEFAULT_API_ORIGIN;
    try {
      if (/^https?:\/\//i.test(configured)) return new URL(configured).origin;
      var host = configured.replace(/^\/\//, '').split('/')[0];
      if (!host) return DEFAULT_API_ORIGIN;
      if (host.indexOf('.') < 0) host += '.n4.bjmantis.cn';
      return 'https://' + host;
    } catch (_) {
      return DEFAULT_API_ORIGIN;
    }
  }

  function randomString(length) {
    var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    var result = '';
    for (var i = 0; i < length; i += 1) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }

  function getTimestamp() {
    var offset = parseInt(storageValue('serviceIntervalTime'), 10);
    if (!Number.isFinite(offset)) offset = 0;
    return parseInt(String(Date.now() + offset).slice(0, 10), 10);
  }

  function getUsername() {
    return storageValue('mantisUserName', 'username', 'userName') || 'username is error';
  }

  function getHeaderSign(pathname, username, timestamp) {
    if (typeof window._mGetSign !== 'function') return '';
    try {
      return asString(window._mGetSign([pathname, username.toLowerCase(), timestamp]));
    } catch (_) {
      return '';
    }
  }

  function add32(a, b) { return (a + b) & 0xFFFFFFFF; }
  function rotateLeft(value, bits) { return (value << bits) | (value >>> (32 - bits)); }
  function cmn(q, a, b, x, s, t) { return add32(rotateLeft(add32(add32(a, q), add32(x, t)), s), b); }
  function ff(a, b, c, d, x, s, t) { return cmn((b & c) | ((~b) & d), a, b, x, s, t); }
  function gg(a, b, c, d, x, s, t) { return cmn((b & d) | (c & (~d)), a, b, x, s, t); }
  function hh(a, b, c, d, x, s, t) { return cmn(b ^ c ^ d, a, b, x, s, t); }
  function ii(a, b, c, d, x, s, t) { return cmn(c ^ (b | (~d)), a, b, x, s, t); }

  function md5Cycle(state, block) {
    var a = state[0];
    var b = state[1];
    var c = state[2];
    var d = state[3];
    a = ff(a, b, c, d, block[0], 7, -680876936); d = ff(d, a, b, c, block[1], 12, -389564586); c = ff(c, d, a, b, block[2], 17, 606105819); b = ff(b, c, d, a, block[3], 22, -1044525330);
    a = ff(a, b, c, d, block[4], 7, -176418897); d = ff(d, a, b, c, block[5], 12, 1200080426); c = ff(c, d, a, b, block[6], 17, -1473231341); b = ff(b, c, d, a, block[7], 22, -45705983);
    a = ff(a, b, c, d, block[8], 7, 1770035416); d = ff(d, a, b, c, block[9], 12, -1958414417); c = ff(c, d, a, b, block[10], 17, -42063); b = ff(b, c, d, a, block[11], 22, -1990404162);
    a = ff(a, b, c, d, block[12], 7, 1804603682); d = ff(d, a, b, c, block[13], 12, -40341101); c = ff(c, d, a, b, block[14], 17, -1502002290); b = ff(b, c, d, a, block[15], 22, 1236535329);
    a = gg(a, b, c, d, block[1], 5, -165796510); d = gg(d, a, b, c, block[6], 9, -1069501632); c = gg(c, d, a, b, block[11], 14, 643717713); b = gg(b, c, d, a, block[0], 20, -373897302);
    a = gg(a, b, c, d, block[5], 5, -701558691); d = gg(d, a, b, c, block[10], 9, 38016083); c = gg(c, d, a, b, block[15], 14, -660478335); b = gg(b, c, d, a, block[4], 20, -405537848);
    a = gg(a, b, c, d, block[9], 5, 568446438); d = gg(d, a, b, c, block[14], 9, -1019803690); c = gg(c, d, a, b, block[3], 14, -187363961); b = gg(b, c, d, a, block[8], 20, 1163531501);
    a = gg(a, b, c, d, block[13], 5, -1444681467); d = gg(d, a, b, c, block[2], 9, -51403784); c = gg(c, d, a, b, block[7], 14, 1735328473); b = gg(b, c, d, a, block[12], 20, -1926607734);
    a = hh(a, b, c, d, block[5], 4, -378558); d = hh(d, a, b, c, block[8], 11, -2022574463); c = hh(c, d, a, b, block[11], 16, 1839030562); b = hh(b, c, d, a, block[14], 23, -35309556);
    a = hh(a, b, c, d, block[1], 4, -1530992060); d = hh(d, a, b, c, block[4], 11, 1272893353); c = hh(c, d, a, b, block[7], 16, -155497632); b = hh(b, c, d, a, block[10], 23, -1094730640);
    a = hh(a, b, c, d, block[13], 4, 681279174); d = hh(d, a, b, c, block[0], 11, -358537222); c = hh(c, d, a, b, block[3], 16, -722521979); b = hh(b, c, d, a, block[6], 23, 76029189);
    a = hh(a, b, c, d, block[9], 4, -640364487); d = hh(d, a, b, c, block[12], 11, -421815835); c = hh(c, d, a, b, block[15], 16, 530742520); b = hh(b, c, d, a, block[2], 23, -995338651);
    a = ii(a, b, c, d, block[0], 6, -198630844); d = ii(d, a, b, c, block[7], 10, 1126891415); c = ii(c, d, a, b, block[14], 15, -1416354905); b = ii(b, c, d, a, block[5], 21, -57434055);
    a = ii(a, b, c, d, block[12], 6, 1700485571); d = ii(d, a, b, c, block[3], 10, -1894986606); c = ii(c, d, a, b, block[10], 15, -1051523); b = ii(b, c, d, a, block[1], 21, -2054922799);
    a = ii(a, b, c, d, block[8], 6, 1873313359); d = ii(d, a, b, c, block[15], 10, -30611744); c = ii(c, d, a, b, block[6], 15, -1560198380); b = ii(b, c, d, a, block[13], 21, 1309151649);
    a = ii(a, b, c, d, block[4], 6, -145523070); d = ii(d, a, b, c, block[11], 10, -1120210379); c = ii(c, d, a, b, block[2], 15, 718787259); b = ii(b, c, d, a, block[9], 21, -343485551);
    state[0] = add32(state[0], a); state[1] = add32(state[1], b); state[2] = add32(state[2], c); state[3] = add32(state[3], d);
  }

  function md5Block(value) {
    var block = [];
    for (var i = 0; i < 64; i += 4) block[i >> 2] = value.charCodeAt(i) | (value.charCodeAt(i + 1) << 8) | (value.charCodeAt(i + 2) << 16) | (value.charCodeAt(i + 3) << 24);
    return block;
  }

  function md5(value) {
    if (window.CryptoJS && typeof window.CryptoJS.MD5 === 'function') return window.CryptoJS.MD5(value).toString();
    var encoded = unescape(encodeURIComponent(value));
    var length = encoded.length;
    var state = [1732584193, -271733879, -1732584194, 271733878];
    var i;
    for (i = 64; i <= length; i += 64) md5Cycle(state, md5Block(encoded.substring(i - 64, i)));
    var tail = Array(16).fill(0);
    var remainder = encoded.substring(i - 64);
    for (var j = 0; j < remainder.length; j += 1) tail[j >> 2] |= remainder.charCodeAt(j) << ((j % 4) << 3);
    tail[remainder.length >> 2] |= 0x80 << ((remainder.length % 4) << 3);
    if (remainder.length > 55) { md5Cycle(state, tail); tail = Array(16).fill(0); }
    tail[14] = length * 8;
    md5Cycle(state, tail);
    function hex(value) {
      var output = '';
      for (var k = 0; k < 4; k += 1) output += ('0' + ((value >>> (k * 8)) & 0xFF).toString(16)).slice(-2);
      return output;
    }
    return hex(state[0]) + hex(state[1]) + hex(state[2]) + hex(state[3]);
  }

  function companyId(company) {
    return asString(company.id) || asString(company.name) + ':' + asString(company.contact || company.legalPerson);
  }

  function extractPhone(value) {
    var text = asString(value).trim();
    var match = text.match(/\+?\d[\d\s()-]{5,}\d/);
    return match ? match[0].replace(/[\s()-]/g, '') : '';
  }

  function companyPhone(company) {
    var directPhone = extractPhone(company.contact)
      || extractPhone(company.mobilePhone)
      || extractPhone(company.fixedPhone)
      || extractPhone(company.phone);
    if (directPhone) return directPhone;
    var details = Array.isArray(company.contactDetails) ? company.contactDetails : [];
    for (var i = 0; i < details.length; i += 1) {
      var detailPhone = extractPhone(details[i] && (details[i].content || details[i].phone || details[i].value));
      if (detailPhone) return detailPhone;
    }
    return '';
  }

  function getMscCode() {
    if (pageUrl.hostname === 'bdtg.n4.bjmantis.cn') return BDTG_MSC_CODE;
    if (pageUrl.hostname === 'njtlqc.n4.bjmantis.cn') return NJTLQC_MSC_CODE;
    return storageValue('mantisCustomerMscCode', 'customerMscCode') || DEFAULT_MSC_CODE;
  }

  function companyInfoText(company) {
    var contactName = asString(company.contactName);
    if (!contactName || contactName.indexOf('*') >= 0) contactName = asString(company.legalPerson);
    var industry = [company.industry, company.secondIndustry, company.thirdIndustry, company.fourthIndustry].filter(Boolean).join(' / ');
    var lines = [
      '线索来源：企业查询平台企业搜索接口',
      '企业名称：' + asString(company.name),
      '企业编号：' + asString(company.id),
      '法定代表人：' + asString(company.legalPerson),
      '联系电话：' + companyPhone(company),
      '联系邮箱：' + asString(company.email),
      '联系人：' + contactName,
      '联系地址：' + asString(company.contactAddress || company.address),
      '企业状态：' + asString(company.status),
      '所属行业：' + industry,
      '注册资本：' + asString(company.registeredCapital),
      '成立日期：' + (company.establishmentDate ? new Date(company.establishmentDate).toISOString().slice(0, 10) : ''),
      '官方网站：' + asString(company.officialWebsite),
      '统一社会信用代码：' + asString(company.socialCreditCode),
      '企业标签：' + (Array.isArray(company.tags) ? company.tags.join('、') : ''),
    ].filter(function (value) { return value.split('：').slice(1).join('：').trim(); });

    var details = Array.isArray(company.contactDetails) ? company.contactDetails : [];
    if (details.length > 0) {
      lines.push('联系方式明细：');
      details.forEach(function (detail, index) {
        var detailLines = [
          (index + 1) + '. 内容：' + asString(detail && detail.content),
          '类型：' + asString(detail && detail.type),
          '联系人：' + asString(detail && detail.contactName),
          '部门：' + asString(detail && detail.department),
          '职位：' + asString(detail && detail.position),
          '地区：' + asString(detail && detail.area),
          '运营商：' + asString(detail && detail.carrier),
          '号码状态：' + asString(detail && detail.status),
          '是否有效：' + (typeof (detail && detail.valid) === 'boolean' ? (detail.valid ? '是' : '否') : ''),
          '来源：' + (Array.isArray(detail && detail.sources) ? detail.sources.join('、') : ''),
        ].filter(function (value) { return value.split('：').slice(1).join('：').trim(); });
        lines.push(detailLines.join('；'));
      });
    }

    return lines.join('\n').slice(0, FIELD_ELEVEN_MAX_LENGTH);
  }

  function buildPayload(company) {
    if (activeConfig.preparedFields && typeof activeConfig.preparedFields === 'object') {
      var frozen = Object.assign({}, activeConfig.preparedFields);
      frozen.sign = md5(COPY_TYPE + asString(frozen.phone1) + MANTIS_VERIFICATION);
      return frozen;
    }
    var phone = companyPhone(company);
    var contactName = asString(company.contactName);
    if (!contactName || contactName.indexOf('*') >= 0) contactName = asString(company.legalPerson);
    var body = {
      customerCompanyName: asString(company.name),
      phone1: phone,
      name: contactName,
      field_three: asString(company.id),
      provinceId: activeConfig.provinceId,
      field_eleven: companyInfoText(company),
      productId: activeConfig.productId,
      mscCode: activeConfig.mscCode,
      areaId: activeConfig.areaId,
      tagIds: [],
      field_four: '',
      resvFlag: 'N',
      nextContactTime: null,
      pageMode: true,
      visitRemind: 'FALSE',
      needMergeFlag: true,
      sourceType: 'SOURCE_MANUAL',
      customerSourse: 'TMK',
      pageType: window.location.pathname,
      copyValueType: 'business',
      copyType: COPY_TYPE,
    };
    body.sign = md5(COPY_TYPE + phone + MANTIS_VERIFICATION);
    return body;
  }

  function requestCompany(company) {
    return new Promise(function (resolve) {
      var phone = activeConfig.preparedFields ? asString(activeConfig.preparedFields.phone1) : companyPhone(company);
      if (!phone) {
        resolve({
          companyId: companyId(company),
          companyName: asString(company.name),
          status: 'failed',
          message: '企业没有可用联系电话，已跳过录入'
        });
        return;
      }
      if (currentIdentity() !== activeConfig.targetIdentity) { resolve({companyId: companyId(company), status:'failed',message:'CRM 公司或账号已切换，未提交'}); return; }
      var timestamp = getTimestamp();
      var username = getUsername();
      var xhr = new XMLHttpRequest();
      var apiUrl = getApiOrigin() + API_PATH;
      var nonce = String(Date.now()) + randomString(13) + (window.electron ? 'SYS_ELECTRON' : 'SYS_INNER');
      var authorization = storageValue('access_token', 'accessToken', 'token');
      var body = buildPayload(company);
      var settled = false;
      var debugRequest = {
        method: 'POST',
        url: apiUrl,
        headers: {
          Accept: 'application/json, text/plain, */*',
          'Content-Type': 'application/json',
          nonce: nonce,
          timestamp: String(timestamp),
          sign: getHeaderSign(API_PATH, username, timestamp),
          MantisEnv: storageValue('enterprise_id', 'enterpriseId'),
          MantisEnvTarget: storageValue('serverName', 'server_name'),
          Authorization: '[已隐藏]',
        },
        body: body,
      };

      function debugResult(status, response, responseText) {
        return {
          request: { method: 'POST', url: apiUrl },
          response: {
            status: status,
            body: response,
            text: asString(responseText).slice(0, 10000),
          },
        };
      }

      

      function finish(result) {
        if (settled) return;
        settled = true;
        resolve(result);
      }

      xhr.open('POST', apiUrl, true);
      xhr.withCredentials = true;
      xhr.setRequestHeader('Accept', 'application/json, text/plain, */*');
      xhr.setRequestHeader('Content-Type', 'application/json');
      if (authorization) xhr.setRequestHeader('Authorization', /^Bearer\s/i.test(authorization) ? authorization : 'Bearer ' + authorization);
      xhr.setRequestHeader('nonce', nonce);
      xhr.setRequestHeader('timestamp', String(timestamp));
      var headerSign = getHeaderSign(API_PATH, username, timestamp);
      if (headerSign) xhr.setRequestHeader('sign', headerSign);
      var mantisEnv = storageValue('enterprise_id', 'enterpriseId');
      var mantisTarget = storageValue('serverName', 'server_name');
      if (mantisEnv) xhr.setRequestHeader('MantisEnv', mantisEnv);
      if (mantisTarget) xhr.setRequestHeader('MantisEnvTarget', mantisTarget);

      xhr.addEventListener('load', function () {
        var response = null;
        try { response = xhr.responseText ? JSON.parse(xhr.responseText) : null; } catch (_) { response = null; }
        var debug = debugResult(xhr.status, response, xhr.responseText);
        
        if (xhr.status < 200 || xhr.status >= 300) {
          finish({ companyId: companyId(company), companyName: asString(company.name), status: 'unknown', message: 'HTTP ' + xhr.status, debug: debug });
          return;
        }
        var message = asString(response && response.message);
        var flag = response && Number(response.flag);
        if (flag === 1) {
          finish({ companyId: companyId(company), companyName: asString(company.name), status: 'recorded', message: message, debug: debug });
        } else if (flag === 0 && /(exist|already|duplicate|已存在|重复)/i.test(message)) {
          finish({ companyId: companyId(company), companyName: asString(company.name), status: 'duplicate', message: message, debug: debug });
        } else {
          finish({ companyId: companyId(company), companyName: asString(company.name), status: flag === 0 ? 'failed' : 'unknown', message: message || 'CRM returned an unsuccessful result', debug: debug });
        }
      });
      xhr.addEventListener('error', function () {
        var debug = debugResult(xhr.status || 0, null, 'Network request failed');
        
        finish({ companyId: companyId(company), companyName: asString(company.name), status: 'unknown', message: 'Network request failed', debug: debug });
      });
      xhr.addEventListener('timeout', function () {
        var debug = debugResult(xhr.status || 0, null, 'Request timed out');
        
        finish({ companyId: companyId(company), companyName: asString(company.name), status: 'unknown', message: 'Request timed out', debug: debug });
      });
      xhr.timeout = 30000;
      xhr.send(JSON.stringify(body));
    });
  }

  async function execute(jobId, companies) {
    if (running) return;
    running = true;
    var items = [];
    try {
      // Give the CRM bundle time to install its XHR signer and hydrate login state.
      await new Promise(function (resolve) { window.setTimeout(resolve, 900); });
      for (var i = 0; i < companies.length; i += 1) {
        items.push(await requestCompany(companies[i] || {}));
        if (i < companies.length - 1) {
          await new Promise(function (resolve) { window.setTimeout(resolve, RECORD_BETWEEN_REQUESTS_MS); });
        }
      }
      window.postMessage({ source: source, type: 'result', jobId: jobId, items: items }, '*');
    } catch (error) {
      window.postMessage({ source: source, type: 'result', jobId: jobId, error: asString(error) || 'Customer record failed' }, '*');
    } finally {
      running = false;
    }
  }

  var readyPosted = false;
  function postReady() {
    if (readyPosted) return;
    if (document.readyState === 'loading') {
      window.setTimeout(postReady, 250);
      return;
    }
    readyPosted = true;
    window.postMessage({ source: source, type: 'ready' }, '*');
  }

  window.addEventListener('message', function (event) {
    if (event.source !== window || !event.data || event.data.source !== source) return;
    if (event.data.type === 'ping') {
      postReady();
      return;
    }
    if (event.data.type === 'execute' && typeof event.data.jobId === 'string' && Array.isArray(event.data.companies)) {
      activeConfig = event.data.config || {};
      MANTIS_VERIFICATION = asString(activeConfig.verification);
      if (!MANTIS_VERIFICATION || currentIdentity() !== activeConfig.targetIdentity) {
        window.postMessage({source:source,type:'result',jobId:event.data.jobId,error:'CRM 环境或验证配置不匹配'}, '*'); return;
      }
      void execute(event.data.jobId, event.data.companies);
    }
  });


  function currentIdentity() {
    return JSON.stringify({host: location.hostname, enterpriseId: storageValue('enterprise_id','enterpriseId'), username: storageValue('mantisUserName','username','userName'), serverName: storageValue('serverName','server_name','mantisServerName')});
  }
  window.__mole_crm_preview__ = function(company, config) {
    activeConfig = config || {}; MANTIS_VERIFICATION = '';
    var body = buildPayload(company); delete body.sign; return body;
  };

  postReady();
})();
