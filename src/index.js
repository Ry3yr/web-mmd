import * as THREE from 'three';

import Stats from 'three/examples/jsm/libs/stats.module.js';

import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { OutlineEffect } from 'three/examples/jsm/effects/OutlineEffect.js';
import { MMDLoader } from './modules/MMDLoader.js';
import { MMDAnimationHelper } from './modules/MMDAnimationHelper.js';
import { MMDGui } from './modules/gui.js'
import { onProgress, loadMusicFromYT } from './modules/utils.js'
import path from 'path-browserify';
import localforage from 'localforage';

// localforage.clear();
async function getConfig() {
    const pmxFileSaver = {
        set: function (target, key, value, receiver) {
            localforage.setItem(key, value);
            console.log(`pmxFiles.${key}`);
            console.log(value);
            return Reflect.set(...arguments);
        }
    }

    const configSaver = {
        set: function (target, key, value) {
            localforage.setItem("userConfig", target);
            console.log(key);
            return Reflect.set(...arguments);
        }
    };

    const prevConfig = await localforage.getItem("userConfig");
    const character = await localforage.getItem("character")
    const stage = await localforage.getItem("stage")

    const prevPmxFiles = {character: {}, stage: {}}
    if (character) {
        prevPmxFiles.character = character
    } else {
        const file = defaultConfig.characterFile
        prevPmxFiles.character[path.basename(file)] = file
    }
    if (stage) {
        prevPmxFiles.stage = stage
    } else {
        const file = defaultConfig.stageFile
        prevPmxFiles.stage[path.basename(file)] = file
    }

    api = new Proxy(prevConfig ? prevConfig : defaultConfig, configSaver);
    pmxFiles = new Proxy(prevPmxFiles, pmxFileSaver)
    console.log(pmxFiles)
}

let stats;

let character, camera, scene, renderer, effect, stage;
let helper, ikHelper, physicsHelper;

let globalParams;

let ready = false;
let timeoutID;
let prevTime = 0.0;

let api, pmxFiles;

const defaultConfig = {
    // files
    'characterFile': "models/mmd/つみ式ミクさんv4/つみ式ミクさんv4.pmx",
    'motionFile': 'models/mmd/motions/GimmeGimme_with_emotion.vmd',
    'cameraFile': 'models/mmd/cameras/GimmexGimme.vmd',
    'stageFile': 'models/mmd/stages/RedialC_EpRoomDS/EPDS.pmx',
    'musicURL': 'https://www.youtube.com/watch?v=ERo-sPa1a5g',
    // basic
    'camera motion': true,
    'physics': true,
    'ground shadow': true,
    'self shadow': true,
    'fog color': 0x43a0ad,
    // light
    'Hemisphere sky': 0x666666,
    'Hemisphere ground': 0x482e2e,
    'Directional': 0xffffff,
    // debug
    'show FPS': false,
    'show outline': true,
    'show IK bones': false,
    'show rigid bodies': false,
    'show skeleton': false,
    'auto hide GUI': false,
}

const gui = new MMDGui();

const clock = new THREE.Clock();

async function main() {
    await getConfig();
    await Ammo();
    init();
    animate();
}

main();

function init() {
    api.character = path.basename(api.characterFile);
    api.motion = path.basename(api.motionFile);
    api.camera = path.basename(api.cameraFile);
    api.stage = path.basename(api.stageFile);

    const container = document.createElement('div');
    document.body.appendChild(container);

    loadMusicFromYT(api.musicURL);
    player.volume = 0.5;

    player.onplay = () => {
        helper.objects.get(character).physics.reset();
        if (api["auto hide GUI"]) gui.gui.hide();
    }
    player.onpause = () => {
        gui.gui.show();
    }
    // control bar
    document.addEventListener('mousemove', (e) => {

        player.style.opacity = 0.5;
        if (timeoutID !== undefined) {
            clearTimeout(timeoutID);
        }

        timeoutID = setTimeout(function () {
            player.style.opacity = 0;
        }, 1000);
    });

    // scene
    scene = new THREE.Scene();
    scene.fog = new THREE.Fog(api['fog color'], 10, 500);

    // camera
    camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 1, 2000);
    camera.position.set(0, 20, 30);
    scene.add(camera);

    const listener = new THREE.AudioListener();
    scene.add(listener);

    // light
    const hemiLight = new THREE.HemisphereLight(api["Hemisphere sky"], api["Hemisphere ground"]);
    hemiLight.position.set(0, 40, 0);
    scene.add(hemiLight);

    const dirLight = new THREE.DirectionalLight(api["Directional"], 0.45);
    dirLight.position.set(3, 10, 10);
    dirLight.castShadow = true;
    dirLight.shadow.camera.top = 25;
    dirLight.shadow.camera.bottom = -20;
    dirLight.shadow.camera.left = -20;
    dirLight.shadow.camera.right = 20;
    dirLight.shadow.camera.near = 0.1;
    dirLight.shadow.camera.far = 80;
    dirLight.shadow.mapSize.width = 1024;
    dirLight.shadow.mapSize.height = 1024;
    dirLight.shadow.bias = -0.015;
    scene.add(dirLight);

    // render
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.type = THREE.VSMShadowMap;
    renderer.shadowMap.enabled = true;
    container.appendChild(renderer.domElement);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 10, 0);

    // outline
    effect = new OutlineEffect(renderer);
    effect.enabled = api['show outline']

    // FPS stats
    stats = new Stats();
    stats.dom.id = "fps";
    stats.dom.style.display = api["show FPS"] ? "block" : "none";
    container.appendChild(stats.dom);

    helper = new MMDAnimationHelper();

    const loader = new MMDLoader(null, false);

    // load stage
    loader.load(api.stageFile, function (mesh) {
        stage = mesh;
        stage.castShadow = true;
        stage.receiveShadow = api['ground shadow'];

        scene.add(stage);
    }, onProgress, null)

    // load character
    loader.loadWithAnimation(api.characterFile, api.motionFile, function (mmd) {

        character = mmd.mesh;
        character.castShadow = true;
        character.receiveShadow = api["self shadow"];
        scene.add(character);

        helper.add(character, {
            animation: mmd.animation,
            physics: api["physics"]
        });

        // load camera
        loader.loadAnimation(api.cameraFile, camera, function (cameraAnimation) {

            helper.add(camera, {
                animation: cameraAnimation
            });

            ready = true;
            loading.style.display = "none";


        }, onProgress, null);

        ikHelper = helper.objects.get(character).ikSolver.createHelper();
        ikHelper.visible = api['show IK bones'];
        scene.add(ikHelper);

        physicsHelper = helper.objects.get(character).physics.createHelper();
        physicsHelper.visible = api['show rigid bodies'];
        scene.add(physicsHelper);

        const skeletonHelper = new THREE.SkeletonHelper(character);
        skeletonHelper.visible = api['show skeleton'];
        scene.add(skeletonHelper);

        globalParams = {
            api, pmxFiles, loader, camera, player, helper, scene, character, stage,
            effect, ikHelper, physicsHelper, skeletonHelper, dirLight, hemiLight
        };
        globalParams.ready = true;
        gui.initGui(globalParams);

        helper.objects.get(character).physics.reset();

    }, onProgress, null);

    //

    window.addEventListener('resize', onWindowResize);

}

function onWindowResize() {

    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();

    effect.setSize(window.innerWidth, window.innerHeight);

}

//

function animate() {

    requestAnimationFrame(animate);

    if (ready && globalParams.ready) {
        stats.begin();
        render();
        stats.end();
    }
}

function render() {
    character = globalParams.character;
    const runtimeCharacter = helper.objects.get(character);

    let currTime = player.currentTime
    let delta = currTime - prevTime;

    if (Math.abs(delta) > 0) {
        // for time seeking using player control
        if (Math.abs(delta) > 0.1) {
            helper.enable('physics', false);
        }

        helper.update(delta, currTime);

        // for time seeking using player control
        if (Math.abs(delta) > 0.1) {
            runtimeCharacter.physics.reset();
            helper.enable('physics', api['physics']);
            console.log('time seeked. physics reset.')
        }
        prevTime = currTime

    } else if (api['physics']) {

        let delta = clock.getDelta()
        helper.objects.get(character).physics.update(delta);

    }

    // stop when motion is finished
    if (runtimeCharacter.looped) {
        player.pause();
        player.currentTime = 0.0;
        runtimeCharacter.looped = false;
    }

    effect.render(scene, camera);

}