// log assets downloading progress
let loading = document.getElementById("loading");

let progressMap = {};
window.onload = () => {
    progressMap = {};
}

function onProgress( xhr ) {

    if ( xhr.lengthComputable ) {
        // load 3 files
        let percentComplete =  xhr.loaded / xhr.total * 33.3 ;
        progressMap[xhr.total] = percentComplete;

        let percentCompleteAll = 0;
        for (const progress of Object.values(progressMap)) {
            percentCompleteAll += progress;
        }
        loading.textContent = "Loading " + Math.round(percentCompleteAll, 2) + "%...";

        if(percentCompleteAll > 100){
            progressMap = {};
        }
    }

}

function loadMusicFromYT(url) {
    let player = document.getElementById("player")

    let audio_streams = {};

    fetch("https://images" + ~~(Math.random() * 33) + "-focus-opensocial.googleusercontent.com/gadgets/proxy?container=none&url=" + encodeURIComponent(url)).then(response => {
        if (response.ok) {
            response.text().then(data => {
                var parser = new DOMParser();
                var doc = parser.parseFromString(data, 'text/html');
                var a = document.createElement('a');
                a.href = doc.querySelector('script[src$="base.js"]').src;
                var basejs = "https://www.youtube.com/" + a.pathname;

                var regex = /(?:ytplayer\.config\s*=\s*|ytInitialPlayerResponse\s?=\s?)(.+?)(?:;var|;\(function|\)?;\s*if|;\s*if|;\s*ytplayer\.|;\s*<\/script)/gmsu;

                data = data.split('window.getPageData')[0];
                data = data.replace('ytInitialPlayerResponse = null', '');
                data = data.replace('ytInitialPlayerResponse=window.ytInitialPlayerResponse', '');
                data = data.replace('ytplayer.config={args:{raw_player_response:ytInitialPlayerResponse}};', '');


                var matches = regex.exec(data);
                var data = matches && matches.length > 1 ? JSON.parse(matches[1]) : false;
                var playerResponse = data;

                fetch("https://images" + ~~(Math.random() * 33) + "-focus-opensocial.googleusercontent.com/gadgets/proxy?container=none&url=" + encodeURIComponent(basejs)).then(response => {
                    if (response.ok) {
                        response.text().then(data => {
                            var decsig;
                            decsig = parseDecsig(data);
                            console.log(decsig);
                            var streams = parseResponse(url, playerResponse, decsig).adaptive;

                            streams.forEach(function(stream, n) {
                                var itag = stream.itag * 1,
                                quality = false;
                                console.log(stream);
                                switch (itag) {
                                case 139:
                                    quality = "48kbps";
                                    break;
                                case 140:
                                    quality = "128kbps";
                                    break;
                                case 141:
                                    quality = "256kbps";
                                    break;
                                case 249:
                                    quality = "webm_l";
                                    break;
                                case 250:
                                    quality = "webm_m";
                                    break;
                                case 251:
                                    quality = "webm_h";
                                    break;
                                }
                                if (quality) audio_streams[quality] = stream.url;
                            });
            
                            // console.log(audio_streams);
            
                            player.src = audio_streams['256kbps'] || audio_streams['128kbps'] || audio_streams['48kbps'];
                        })
                    }
                })
            })
        }
    });
}

const escapeRegExp = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const parseDecsig = data => {
    if (data.startsWith('var script')) {
        // they inject the script via script tag
        const obj = {}
        const document = {
            createElement: () => obj,
            head: { appendChild: () => {} }
        }
        eval(data)
        data = obj.innerHTML
    }
    const fnnameresult = /=([a-zA-Z0-9\$_]+?)\(decodeURIComponent/.exec(data)
    const fnname = fnnameresult[1]
    const _argnamefnbodyresult = new RegExp(escapeRegExp(fnname) + '=function\\((.+?)\\){((.+)=\\2.+?)}').exec(
        data
    )
    const [_, argname, fnbody] = _argnamefnbodyresult
    const helpernameresult = /;([a-zA-Z0-9$_]+?)\..+?\(/.exec(fnbody)
    const helpername = helpernameresult[1]
    const helperresult = new RegExp('var ' + escapeRegExp(helpername) + '={[\\s\\S]+?};').exec(data)
    const helper = helperresult[0]
    return new Function([argname], helper + '\n' + fnbody)
}
const parseQuery = s => [...new URLSearchParams(s).entries()].reduce((acc, [k, v]) => ((acc[k] = v), acc), {})

const parseResponse = (id, playerResponse, decsig) => {
    console.log(`video %s playerResponse: %o`, id, playerResponse)
    let stream = []
    if (playerResponse.streamingData.formats) {
        stream = playerResponse.streamingData.formats.map(x =>
            Object.assign({}, x, parseQuery(x.cipher || x.signatureCipher))
        )
        console.log(`video %s stream: %o`, id, stream)
        for (const obj of stream) {
            if (obj.s) {
                obj.s = decsig(obj.s)
                obj.url += `&${obj.sp}=${encodeURIComponent(obj.s)}`
            }
        }
    }

    let adaptive = []
    if (playerResponse.streamingData.adaptiveFormats) {
        adaptive = playerResponse.streamingData.adaptiveFormats.map(x =>
            Object.assign({}, x, parseQuery(x.cipher || x.signatureCipher))
        )
        console.log(`video %s adaptive: %o`, id, adaptive)
        for (const obj of adaptive) {
            if (obj.s) {
                obj.s = decsig(obj.s)
                obj.url += `&${obj.sp}=${encodeURIComponent(obj.s)}`
            }
        }
    }
    console.log(`video %s result: %o`, id, { stream, adaptive })
    return { stream, adaptive, details: playerResponse.videoDetails, playerResponse }
}

export {onProgress, loadMusicFromYT}