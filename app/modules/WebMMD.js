import * as THREE from 'three';
import videojs from 'video.js'

import Stats from 'three/examples/jsm/libs/stats.module.js';

import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { DebugEnvironment } from 'three/examples/jsm/environments/DebugEnvironment.js';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { MMDLoader } from './MMDLoader.js';
import { MMDAnimationHelper } from './MMDAnimationHelper.js';
import { MMDGui } from './gui.js'
import { onProgress, loadMusicFromYT, withProgress, dataURItoBlobUrl } from '../utils/base.js'
import { PostProcessor } from './postProcessor.js'

import path from 'path-browserify';
import localforage from 'localforage';
import { CameraMode, MMDCameraWorkHelper } from './MMDCameraWorkHelper.js';
import logging from 'webpack/lib/logging/runtime'

class WebMMD {
    constructor() {
        // Global properties

        // main helpers
        this.helper = new MMDAnimationHelper();
        this.cwHelper = new MMDCameraWorkHelper();

        // Private properties
        this._timeoutID;
        this._prevTime = 0.0;
        this._clock = new THREE.Clock();
        this._gui = new MMDGui();

        this._logger = logging.getLogger("WebMMD")
    }

    async start() {
        await Promise.all([this._getConfig(), Ammo()]);
        await this._setup();
        await this._loadFiles();
        this._loadEffects();
        this._loadGui();

        this._animate();
    }

    async _getConfig() {
        const configSep = "."
        this.configSep = configSep

        const scope = this
        const configSaver = {
            set: function (target, key, value) {
                scope._gui.panel.title("Controls (Saving...)");
                const saveAsync = async () => {
                    const targetPreset = scope.preset == "Default" ? "Untitled" : scope.preset;
                    await localforage.setItem(`${targetPreset}${configSep}${key}`, value)
                    if (scope.preset == "Default" && scope._gui.changeToUntitled) {
                        await scope._gui.changeToUntitled()
                    }
                    scope._gui.panel.title("Controls");
                };
                if (value !== undefined) {
                    saveAsync();
                }
                // need to put this outside of async func(above) to set back to api for reading
                const result = Reflect.set(...arguments)
                return result
            }
        };

        const configResp = await fetch('presets/Default_config.json')

        const defaultConfig = await configResp.json()

        let userConfig = JSON.parse(JSON.stringify(defaultConfig));

        const savedPresetName = await localforage.getItem("currentPreset")
        const preset = savedPresetName ?? "Default"
        if (!savedPresetName) {
            await localforage.setItem("currentPreset", "Default")
        }

        const savedPresetsList = await localforage.getItem("presetsList")
        const presetsList = savedPresetsList ?? new Set(["Default"])

        // always loads config from localforage (include data)
        await localforage.iterate((val, key) => {
            if (key.startsWith(`${preset}${configSep}`)) {
                const configKey = key.split(`${preset}${configSep}`)[1]
                userConfig[configKey] = val
            }
        })

        // if loaded config not includes data, we loads from Default data json.
        if (!savedPresetName || !("pmxFiles" in userConfig)) {
            const dataResp = withProgress(await fetch('presets/Default_data.json'), 38204932)
            const defaultData = await dataResp.json()
            for (const [key, val] of Object.entries(defaultData)) {
                await localforage.setItem(`${preset}${configSep}${key}`, val);
                userConfig[key] = val
            }
        }

        this._logger.info(userConfig)
        const api = new Proxy(userConfig, configSaver);

        Object.assign(this, { defaultConfig, api, preset, presetsList })
    }

    async _setup() {
        const { api } = this
        
        // music player
        const player = videojs('rawPlayer', {
            "audioOnlyMode": true
        })
        // for testing
        window.vjplayer = player
        if (api.musicURL.startsWith("data:")) {
            player.src(dataURItoBlobUrl(api.musicURL))
        } else {
            loadMusicFromYT(api);
        }

        player.currentTime(api["currentTime"]);
        player.volume(api['volume']);

        // Threejs container
        const container = document.createElement('div');
        document.body.appendChild(container);

        // scene
        const scene = new THREE.Scene();
        scene.fog = new THREE.FogExp2(api['fog color'], api['fog density']);

        // camera
        const camera = new THREE.PerspectiveCamera(api.fov, window.innerWidth / window.innerHeight, api.near, 2000);
        camera.zoom = api.zoom
        camera.position.set(0, 20, 30);
        scene.add(camera);

        // light
        const ambientLight = new THREE.AmbientLight(api["Ambient color"], api["Ambient intensity"]); // soft white light
        scene.add(ambientLight);

        const hemiLight = new THREE.HemisphereLight(api["Hemisphere sky"], api["Hemisphere ground"], api["Hemisphere intensity"]);
        hemiLight.position.set(0, 40, 0);
        scene.add(hemiLight);

        const dirLight = new THREE.DirectionalLight(api["Directional"], api["Directional intensity"]);
        this.updateDirLight = () => {
            dirLight.position.set(api.lightX, api.lightY, api.lightZ).normalize().multiplyScalar(api.distanceScalar);
        }
        this.updateDirLight();

        dirLight.castShadow = true;
        dirLight.shadow.camera.top = 25;
        dirLight.shadow.camera.bottom = -20;
        dirLight.shadow.camera.left = -20;
        dirLight.shadow.camera.right = 20;
        dirLight.shadow.camera.near = 0.1;
        dirLight.shadow.camera.far = 80;
        dirLight.shadow.mapSize.width = api["self shadow"] ? window.innerWidth * 2 : window.innerWidth;
        dirLight.shadow.mapSize.height = api["self shadow"] ? window.innerHeight * 2 : window.innerWidth;
        dirLight.shadow.bias = api["shadow bias"];
        scene.add(dirLight);

        // render
        const renderer = new THREE.WebGLRenderer({
            powerPreference: "high-performance",
            antialias: false,
            stencil: false,
            depth: false
        });

        renderer.setPixelRatio(api['set pixelratio 1.0'] ? 1.0 : window.devicePixelRatio);
        renderer.setSize(window.innerWidth, window.innerHeight);
        // renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        renderer.shadowMap.enabled = true;
        renderer.toneMapping = api["tone mapping"]
        renderer.toneMappingExposure = api.exposure

        container.appendChild(renderer.domElement);
        const controls = new OrbitControls(camera, renderer.domElement);
        controls.autoRotate = api["auto rotate"]
        controls.autoRotateSpeed = api["auto rotate speed"]
        controls.target.set(0, 10, 0);

        // envMaps
        // const environment = new DebugEnvironment( renderer );
        // const pmremGenerator = new THREE.PMREMGenerator( renderer );
        // scene.environment = pmremGenerator.fromScene( environment ).texture;
        // const rgbeLoader = new RGBELoader().setPath( 'https://threejs.org/examples/textures/equirectangular/' );
        // const texture = await rgbeLoader.loadAsync("spot1Lux.hdr");
        // texture.mapping = THREE.EquirectangularReflectionMapping;
        // scene.environment = texture

        // const cubeTextureLoader = new THREE.CubeTextureLoader();
        // const path = 'https://threejs.org/examples/textures/cube/Park2/';
        // const format = '.jpg';
        // const urls = [
        //     path + 'posx' + format, path + 'negx' + format,
        //     path + 'posy' + format, path + 'negy' + format,
        //     path + 'posz' + format, path + 'negz' + format
        // ];
        // const reflectionCube = cubeTextureLoader.load( urls );
        // scene.environment = reflectionCube

        // composer.setPixelRatio(api['set pixelratio 1.0'] ? 1.0 : window.devicePixelRatio);

        // FPS stats
        const stats = new Stats();
        stats.dom.id = "fps";
        stats.dom.style.display = api["show FPS"] ? "block" : "none";
        container.appendChild(stats.dom);

        Object.assign(this, {
            camera, player, controls, scene, stats,
            dirLight, hemiLight, ambientLight,
            renderer
        })
    }

    // get current time for motions (character, camera...etc)
    get motionTime() {
        const currTime = this.player.currentTime() + (this.api.motionOffset * 0.001)
        if (currTime < 0) {
            return 0
        }
        return currTime
    }

    async _loadFiles() {
        const { api, scene, camera, dirLight, helper } = this

        // loader
        const loader = new MMDLoader();

        // load stage
        const _loadStage = async (url = api.pmxFiles.stage[api.stage], filename = api.stage) => {
            const stageParams = {
                enablePBR: api['enable PBR'],
            };
            if (url.startsWith("data:")) {
                Object.assign(stageParams, {
                    modelExtension: path.extname(filename).slice(1),
                    modelTextures: api.pmxFiles.modelTextures.stage[filename],
                })
            }

            const mesh = await loader.load(url, onProgress, null, stageParams)
            const stage = mesh;
            stage.castShadow = true;
            stage.receiveShadow = api['ground shadow'];

            scene.add(stage);
            this.stage = stage
            if (api.stage != filename) {
                api.stage = filename
            }
        }

        // load camera
        const _loadCamera = async (url = api.cameraFile, filename = api.camera) => {
            const cameraAnimation = await loader.loadAnimation(url, camera, onProgress, null);
            helper.add(camera, {
                animation: cameraAnimation,
                enabled: api["camera mode"] == CameraMode.MOTION_FILE
            });

            await this.cwHelper.init(this);
            if (api.cameraFile != url) {
                api.camera = filename;
                api.cameraFile = url;
            }
        }

        // load character
        const _loadCharacter = async (url = api.pmxFiles.character[api.character], filename = api.character) => {
            const characterParams = {
                enableSdef: api['enable SDEF'],
                enablePBR: api['enable PBR'],
                followSmooth: api["follow smooth"]
            };
            if (url.startsWith("data:")) {
                Object.assign(characterParams, {
                    modelExtension: path.extname(filename).slice(1),
                    modelTextures: api.pmxFiles.modelTextures.character[filename]
                });
            }

            const mmd = await loader.loadWithAnimation(url, api.motionFile, onProgress, null, characterParams);
            const character = mmd.mesh;
            character.castShadow = true;
            character.receiveShadow = api["self shadow"];
            scene.add(character);
            dirLight.target = character

            helper.add(character, {
                animation: mmd.animation
            });
            const runtimeCharacter = helper.objects.get(character)

            const ikHelper = runtimeCharacter.ikSolver.createHelper();
            ikHelper.visible = api['show IK bones'];
            scene.add(ikHelper);

            const physicsHelper = runtimeCharacter.physics.createHelper();
            physicsHelper.visible = api['show rigid bodies'];
            helper.enable('physics', api['physics']);
            scene.add(physicsHelper);

            const skeletonHelper = new THREE.SkeletonHelper(character);
            skeletonHelper.visible = api['show skeleton'];
            scene.add(skeletonHelper);

            runtimeCharacter.physics.reset();

            Object.assign(this, {
                loader,
                character,
                runtimeCharacter,
                ikHelper,
                physicsHelper,
                skeletonHelper
            })
            if (api.character != filename) {
                api.character = filename
                this._gui.updateMorphFolder()
            }
        }

        await Promise.all([_loadStage(), _loadCharacter()]);
        // load camera at last so camera-work clips duration will not changed ( because of helper._syncDuration() )
        await _loadCamera();

        overlay.style.display = "none";

        // export util methods for gui
        this.loadCharacter = _loadCharacter
        this.loadStage = _loadStage
        this.loadCamera = _loadCamera
    }

    _loadEffects() {
        const { api, scene, camera, renderer } = this

        // effect composer
        const postprocessor = new PostProcessor(scene, camera, renderer, api)
        postprocessor.bloomEffect.selection.toggle(this.character)

        const { composer } = postprocessor
        Object.assign(this, {
            postprocessor, composer
        })
    }

    _loadGui() {
        this.ready = true;
        this._gui.init(this);
    }

    _animate() {
        if (this.ready) {
            this.stats.begin();
            this._render();
            this.stats.end();
        }

        requestAnimationFrame(this._animate.bind(this));
    }

    _render() {
        const {
            api,
            runtimeCharacter, helper, cwHelper,
            composer, controls, player
        } = this;

        const currTime = this.motionTime
        // player has a bug that sometimes jump to end(duration)
        // so we just skip that frame
        if (player.currentTime() == player.duration()) {
            return
        }
        const delta = currTime - this._prevTime;

        if (Math.abs(delta) > 0) {
            // check if time seeking using player control
            if (Math.abs(delta) > 0.1) {
                helper.enable('physics', false);
            }

            // camera updating
            cwHelper.setTime(currTime);
            // animation updating
            helper.update(delta, currTime);

            // check if time seeking using player control
            if (Math.abs(delta) > 0.1) {
                runtimeCharacter.physics.reset();
                helper.enable('physics', api['physics']);
                this._logger.info('time seeked. physics reset.')
            }
            this._prevTime = currTime

        } else {
            if (controls.autoRotate) {
                controls.update();
            }
            if (api['physics']) {
                let delta = this._clock.getDelta()
                runtimeCharacter.physics.update(delta);
            }
        }

        // stop when motion is finished and then fix physics
        if (runtimeCharacter.looped) {
            player.pause();
            player.currentTime(0.0);

            runtimeCharacter.physics.reset();
            runtimeCharacter.physics.update(0.1)

            runtimeCharacter.looped = false;
        }

        composer.render();

    }
}


export default WebMMD
