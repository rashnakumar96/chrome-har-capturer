'use strict';

const Context = require('./context');
const Stats = require('./stats');

class Timer {
    constructor(milliseconds) {
        this._milliseconds = milliseconds;
    }

    start() {
        this.cancel();
        return new Promise((fulfill, reject) => {
            if (typeof this._milliseconds === 'undefined') {
                // wait indefinitely
                return;
            }
            this._id = setTimeout(fulfill, this._milliseconds);
        });
    }

    cancel() {
        clearTimeout(this._id);
    }
}

class Live {
    constructor({url, index, urls, options}) {
        this._url = url;
        this._index = index;
        this._urls = urls;
        this._options = options;
    }

    async load() {
        // create a fresh new context for this URL
        const context = new Context(this._options);
        const client = await context.create();
        // hooks
        const {preHook, postHook} = this._options;
        const hookArgs = [this._url, client, this._index, this._urls];
        // optionally run the user-defined hook
        if (typeof preHook === 'function') {
            await preHook.apply(null, hookArgs);
        }
        // create (but not start) the page timer
        const timer = new Timer(this._options.timeout);
        // handle proper page load and postHook or related errors
        const pageLoad = async () => {
            try {
                // start the page load and waits for its termination
                const stats = await this._loadPage(client);
                // optionally run the user-defined hook
                if (typeof postHook === 'function') {
                    stats.user = await postHook.apply(null, hookArgs);
                }
                return stats;
            } finally {
                // no-matter-what cleanup functions
                await context.destroy();
                timer.cancel();
            }
        };
        // handle Chrome disconnection
        const disconnection = async () => {
            await new Promise((fulfill, reject) => {
                client.once('disconnect', fulfill);
            });
            timer.cancel();
            throw new Error('Disconnected');
        };
        // handle page timeout
        const timeout = async () => {
            await timer.start();
            await context.destroy();
            throw new Error('Timed out');
        };
        // wait for the first event to happen
        return await Promise.race([
            pageLoad(),
            disconnection(),
            timeout()
        ]);
    }

    async _loadPage(client) {
        // enable domains
        const {Page, Network} = client;
        await Network.enable();
        await Page.enable();
        await client.send("Fetch.enable", {
            patterns: [{
                urlPattern: '*',
                requestStage: "Response" }]
        });
        // register events
        const stats = new Stats(this._url, this._options);
        const termination = new Promise((fulfill, reject) => {
            client.on('event', (event) => {
                stats.processEvent(fulfill, reject, event);
            });
            client.on("Fetch.requestPaused", async (reqEvent) => {
                const { requestId } = reqEvent;
                console.log(`Request "${requestId}" paused.`);

                let responseHeaders = reqEvent.responseHeaders || [];
                // console.log(reqEvent.responseHeaders);
                const {maxage} = this._options
                console.log('maxage', maxage)
                for (let elements of responseHeaders) {
                    if (elements.name.toLowerCase() === 'cache-control') {
                        // if (elements.value.includes("max-age")){
                        //     const CP = elements.value.split("max-age");
                        //     resp=""
                        //     for (let x = 0; x < CP.length-1; x++) {
                        //         resp+=CP[x]
                        //     }
                        //     // elements.value=resp+"max-age=0"
                        // }
                        elements.value="public, max-age="+maxage
                        console.log('first loop', elements)

                    }
                }
                for (let elements of responseHeaders) {
                    if (elements.name.toLowerCase() === 'cache-control') {
                        console.log('second loop check', elements)
                    }
                }
                await client.send("Fetch.continueResponse", { requestId, responseCode: 200, responseHeaders});
                // console.log(reqEvent.responseHeaders);
            });
            // XXX the separation of concerns between live fetching and HAR
            // computation made it necessary to introduce a synthetic event
            // which is the reply of the Network.getResponseBody method
            // if (this._options.content) {
            //     Network.loadingFinished(async ({requestId}) => {
            //         // only for those entries that are being tracked (e.g., not
            //         // for cached items)
            //         if (!stats.entries.get(requestId)) {
            //             return;
            //         }
            //         try {
            //             const params = await Network.getResponseBody({requestId});
            //             const {body, base64Encoded} = params;
            //             stats.processEvent(fulfill, reject, {
            //                 method: 'Network.getResponseBody',
            //                 params: {
            //                     requestId,
            //                     body,
            //                     base64Encoded
            //                 }
            //             });
            //         } catch (err) {
            //             // sometimes it is impossible to fetch the content (see #82)
            //             stats.processEvent(fulfill, reject, {
            //                 method: 'Network.getResponseBody',
            //                 params: {
            //                     requestId
            //                 }
            //             });
            //         }
            //     });
            // }
        });
        // start the page load
        const navigation = Page.navigate({url: this._url});
        // events will determine termination
        await Promise.all([termination, navigation]);
        return stats;
    }
}

module.exports = Live;
