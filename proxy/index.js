// @ts-check

var Buffer = require('buffer').Buffer;

const proxyHeaders = [
  "Content-Type",
  "x-ms-version",
  "x-ms-date",
  "x-ms-blob-type",
  "x-hardware-target"
];

/**
 * @param {import('@azure/functions').Context} context
 * @param {import('@azure/functions').HttpRequest} req
 */
module.exports = async function (context, req) {
  // Only GET and PUT are of interest
  if (req.method !== "GET" && req.method !== "PUT" && req.method !== "POST") {
    return {
      status: 400,
      body: "Only GET, POST, and PUT are supported",
    };
  }
  const target = req.get("x-proxy-to");
  if (!target)
    return {
      status: 400,
      body: "x-proxy-to header is missing",
    };

  let headers = [];
  proxyHeaders.forEach((h) => {
    const v = req.get(h);
    if (v) headers.push([h, v]);
  });

  // Construct the fetch request to the target
  try {
    const response = await fetch(target, {
      method: req.method,
      body: req.bufferBody,
      headers,
    });

    /** @type {{[key: string]: string}} */
    const resultHeaders = {};
    response.headers.forEach(
        (v, k) => {
            if (k !== 'content-length' && k !== 'transfer-encoding') resultHeaders[k] = v;
        });
    let body = await response.arrayBuffer();

    return {
      status: response.status,
      body: Buffer.from(body),
      headers: resultHeaders,
    };
  } catch (e) {
    return {
      status: 500,
      body: "Fetch from " + target + " failed with " + e.toString(),
    };
  }
};
