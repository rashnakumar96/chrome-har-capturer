const puppeteer = require("puppeteer");
const PuppeteerHar = require('puppeteer-har');
const HAR = require('./lib/har');
var fs = require('fs');
var chc = require('chrome-har-capturer');

test();
async function test() {
  const browser = await puppeteer.launch({
    // headless: false,

  });
  const page = await browser.newPage();
  const har = new PuppeteerHar(page);
  await har.start({ path: 'results.har' });

  const client = await page.target().createCDPSession();

  await client.send("Fetch.enable", {
    patterns: [{
        urlPattern: '*',
        requestStage: "Response" }]
  });

    client.on("Fetch.requestPaused", async (reqEvent) => {
    const { requestId } = reqEvent;
    console.log(`Request "${requestId}" paused.`);

    let responseHeaders = reqEvent.responseHeaders || [];
    // console.log(reqEvent.responseHeaders);
    for (let elements of responseHeaders) {
        if (elements.name.toLowerCase() === 'cache-control') {
            if (elements.value.includes("max-age")){
                const CP = elements.value.split("max-age");
                resp=""
                for (let x = 0; x < CP.length-1; x++) {
                    resp+=CP[x]
                }
                // elements.value=resp+"max-age=0"
            }
            elements.value="public, max-age=0"
        }
    }

    await client.send("Fetch.continueResponse", { requestId, responseCode: 200, responseHeaders});
    console.log(reqEvent.responseHeaders);
  });

  // await page.goto("http://www.google.com")

  var c = chc.run(['http://www.google.com']);
  // await page.waitFor(1000);
  c.on('connect', function () {
    console.log('Connected to Chrome');
  });
  c.on('end', function (har) {
      fs.writeFileSync('out.har', JSON.stringify(har));
  });
  c.on('error', function () {
      console.error('Cannot connect to Chrome');
  });

  // await har.stop();


  await browser.close();
  // return;
}
