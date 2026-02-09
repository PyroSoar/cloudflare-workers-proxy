'use strict'

const JS_VER = 11
const MAX_RETRY = 1
const MAX_SIZE = 1048576 // 1MB

const PREFLIGHT_INIT = {
  status: 204,
  headers: new Headers({
    'access-control-allow-origin': '*',
    'access-control-allow-headers': '*',
    'access-control-allow-methods': 'GET,POST,PUT,PATCH,TRACE,DELETE,HEAD,OPTIONS',
    'access-control-max-age': '1728000',
  }),
}

function makeRes(body, status = 200, headers = {}) {
  headers['--ver'] = JS_VER
  headers['access-control-allow-origin'] = '*'
  return new Response(body, {status, headers})
}

function newUrl(urlStr) {
  try {
    return new URL(urlStr)
  } catch (err) {
    return null
  }
}

// 统一伪造 Referer
function forgeReferer(headers, targetObj) {
  const newHeaders = new Headers(headers)
  newHeaders.delete('referer')
  // 固定伪造为目标域名
  newHeaders.set('referer', targetObj.origin + '/')
  return newHeaders
}

addEventListener('fetch', e => {
  const ret = fetchHandler(e)
    .catch(err => makeRes('cfworker error:\n' + err.stack, 502))
  e.respondWith(ret)
})

async function fetchHandler(e) {
  const req = e.request
  const urlStr = req.url
  const urlObj = new URL(urlStr)
  let path = urlObj.href.substr(urlObj.origin.length)

  if (urlObj.protocol === 'http:') {
    urlObj.protocol = 'https:'
    return makeRes('', 301, {
      'strict-transport-security': 'max-age=99999999; includeSubDomains; preload',
      'location': urlObj.href,
    })
  }

  if (req.method === 'OPTIONS') {
    return new Response(null, PREFLIGHT_INIT)
  }

  if (path === '/' || path === '/index.html') {
    const githubUrl = 'https://raw.githubusercontent.com/PyroSoar/cloudflare-workers-proxy/refs/heads/main/index.html'
    const res = await fetch(githubUrl)
    if (!res.ok) {
      return new Response('Failed to load index.html from GitHub', { status: 502 })
    }
    const html = await res.text()
    return new Response(html, {
      status: 200,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'access-control-allow-origin': '*'
      }
    })
  }

  if (path.startsWith('/api/')) {
    return httpHandler(req, path.substring(5), true)
  }

  if (path.startsWith('/fetch/')) {
    const target = path.substring(7)
    const targetUrl = target.replace(/^(https?):\/+/, '$1://')
    const targetObj = newUrl(targetUrl)
    if (!targetObj) {
      return makeRes('invalid proxy url: ' + targetUrl, 403)
    }
    const forgedHeaders = forgeReferer(req.headers, targetObj)
    const reqInit = {
      method: 'GET',
      headers: forgedHeaders,
      redirect: 'manual',
    }
    return proxy(targetObj, reqInit, false, '', 0, false)
  }

  switch (path) {
    case '/works':
      return makeRes('it works')
    default:
      return makeRes('invalid path', 404)
  }
}

async function httpHandler(req, pathname, isApi) {
  const urlStr = pathname.replace(/^(https?):\/+/, '$1://')
  const urlObj = newUrl(urlStr)
  if (!urlObj) {
    return makeRes('invalid proxy url: ' + urlStr, 403)
  }

  const forgedHeaders = forgeReferer(req.headers, urlObj)

  const reqInit = {
    method: req.method,
    headers: forgedHeaders,
    redirect: 'manual',
    body: req.method === 'POST' ? req.body : undefined,
  }

  return proxy(urlObj, reqInit, false, '', 0, isApi)
}

async function proxy(urlObj, reqInit, acehOld, rawLen, retryTimes, isApi) {
  try {
    const headRes = await fetch(urlObj.href, { method: 'HEAD', headers: reqInit.headers })
    const len = headRes.headers.get('content-length')
    if (len && parseInt(len) > MAX_SIZE) {
      return new Response('Payload Too Large', { status: 413 })
    }
  } catch (err) {}

  const res = await fetch(urlObj.href, reqInit)
  const resHdrOld = res.headers
  const resHdrNew = new Headers(resHdrOld)

  if (isApi) {
    const ct = (resHdrOld.get('content-type') || '').toLowerCase()
    const allowedTypes = [
      'text/',
      'application/json',
      'application/xml',
      'application/x-www-form-urlencoded',
      'multipart/form-data',
      'application/octet-stream',
      'application/x-ndjson',
      'text/event-stream',
      'application/vnd.api+json'
    ]
    const ok = allowedTypes.some(type => ct.startsWith(type))
    if (!ok) {
      return new Response('Unsupported Content-Type for /api/: ' + ct, { status: 415 })
    }
  }

  let expose = '*'
  for (const [k, v] of resHdrOld.entries()) {
    if (['access-control-allow-origin','access-control-expose-headers','location','set-cookie'].includes(k)) {
      const x = '--' + k
      resHdrNew.set(x, v)
      if (acehOld) expose += ',' + x
      resHdrNew.delete(k)
    } else if (acehOld &&
      !['cache-control','content-language','content-type','expires','last-modified','pragma'].includes(k)) {
      expose += ',' + k
    }
  }

  if (acehOld) {
    expose += ',--s'
    resHdrNew.set('--t', '1')
  }

  if (rawLen) {
    const newLen = resHdrOld.get('content-length') || ''
    if (rawLen !== newLen) {
      if (retryTimes < MAX_RETRY) {
        urlObj = await parseYtVideoRedir(urlObj, newLen, res)
        if (urlObj) {
          return proxy(urlObj, reqInit, acehOld, rawLen, retryTimes + 1, isApi)
        }
      }
      return makeRes(res.body, 400, {
        '--error': `bad len: ${newLen}, except: ${rawLen}`,
        'access-control-expose-headers': '--error',
      })
    }
    if (retryTimes > 1) resHdrNew.set('--retry', retryTimes)
  }

  let status = res.status
  resHdrNew.set('access-control-expose-headers', expose)
  resHdrNew.set('access-control-allow-origin', '*')
  resHdrNew.set('--s', status)
  resHdrNew.set('--ver', JS_VER)
  resHdrNew.set('cf-workers-path', res.url)

  resHdrNew.set('X-Proxy-Method', reqInit.method || 'GET')
  resHdrNew.set('X-Proxy-Target', urlObj.href)

  resHdrNew.delete('content-security-policy')
  resHdrNew.delete('content-security-policy-report-only')
  resHdrNew.delete('clear-site-data')

  if ([301,302,303,307,308].includes(status)) status += 10

  return new Response(res.body, { status, headers: resHdrNew })
}

function isYtUrl(urlObj) {
  return urlObj.host.endsWith('.googlevideo.com') && urlObj.pathname.startsWith('/videoplayback')
}

async function parseYtVideoRedir(urlObj, newLen, res) {
  if (newLen > 2000) return null
  if (!isYtUrl(urlObj)) return null
  try {
    const data = await res.text()
    urlObj = new URL(data)
  } catch (err) {
    return null
  }
  return isYtUrl(urlObj) ? urlObj : null
}
