import * as THREE from 'three';

import Stats from 'three/examples/jsm/libs/stats.module.js';
import { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js';

import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { OutlineEffect } from 'three/examples/jsm/effects/OutlineEffect.js';
import { MMDLoader } from 'three/examples/jsm/loaders/MMDLoader.js';
import { MMDAnimationHelper } from 'three/examples/jsm/animation/MMDAnimationHelper.js';

let stats;

let mesh, camera, scene, renderer, effect;
let helper, ikHelper, physicsHelper;

let ready = false;
let isPlaying = false;

const api = {
    'play/pause': false,
    'music': true,
    'ground shadow': true,
    'ground color': 0xffffff,
    'background color': 0xa0a0a0,
    'fog color': 0xa0a0a0,
    'self shadow': false,
    'show outline': true,
    'show IK bones': false,
    'show rigid bodies': false,
    // light
    'Hemisphere sky': 0x666666,
    'Hemisphere ground': 0x444444,
    'Directional': 0xffffff,
};

const clock = new THREE.Clock();


Ammo().then( function () {

    init();
    animate();

} );

function init() {


    const container = document.createElement( 'div' );
    document.body.appendChild( container );
    
    // scene
    scene = new THREE.Scene();
    scene.background = new THREE.Color( api['background color'] );
    scene.fog = new THREE.Fog( api['fog color'], 10, 500 );
    
    // camera
    camera = new THREE.PerspectiveCamera( 45, window.innerWidth / window.innerHeight, 1, 2000 );
    camera.position.set( 0, 20, 30 );
    scene.add( camera );
    
    const listener = new THREE.AudioListener();
    scene.add( listener );
    
    // light
    const hemiLight = new THREE.HemisphereLight( api["Hemisphere sky"], api["Hemisphere ground"] );
    hemiLight.position.set( 0, 40, 0 );
    scene.add( hemiLight );

    const dirLight = new THREE.DirectionalLight( api["Directional"], 0.5 );
    dirLight.position.set( 3, 10, 10 );
    dirLight.castShadow = true;
    dirLight.shadow.camera.top = 25;
    dirLight.shadow.camera.bottom = -20;
    dirLight.shadow.camera.left = -20;
    dirLight.shadow.camera.right = 20;
    dirLight.shadow.camera.near = 0.1;
    dirLight.shadow.camera.far = 80;
    dirLight.shadow.mapSize.width = 2048;
    dirLight.shadow.mapSize.height = 1024;
    scene.add( dirLight );


    // ground
    const ground = new THREE.Mesh( new THREE.PlaneGeometry( 1000, 1000 ), new THREE.MeshPhongMaterial( { color: api['ground color'], depthWrite: false } ) );
    ground.rotation.x = - Math.PI / 2;
    ground.receiveShadow = api["ground shadow"];
    scene.add( ground );

    // render
    renderer = new THREE.WebGLRenderer( { antialias: true } );
    renderer.setPixelRatio( window.devicePixelRatio );
    renderer.setSize( window.innerWidth, window.innerHeight );
    renderer.shadowMap.enabled = true;
    container.appendChild( renderer.domElement );
    const controls = new OrbitControls( camera, renderer.domElement );
    controls.target.set( 0, 10, 0 );

    // outline
    effect = new OutlineEffect( renderer );

    // FPS stats
    stats = new Stats();
    container.appendChild( stats.dom );

    // log asset downloading progress

    function onProgress( xhr ) {

        if ( xhr.lengthComputable ) {

            const percentComplete = xhr.loaded / xhr.total * 100;
            console.log( Math.round( percentComplete, 2 ) + '% downloaded' );

        }

    }

    // handle gui color change
    function handleColorChange( color, converSRGBToLinear = false ) {

        return function ( value ) {

            if ( typeof value === 'string' ) {

                value = value.replace( '#', '0x' );

            }

            color.setHex( value );

            if ( converSRGBToLinear === true ) color.convertSRGBToLinear();

        };

    }

    const modelFile = 'models/mmd/つみ式ミクさんv4/つみ式ミクさんv4.pmx';
    const vmdFiles = [ 'models/mmd/motions/GimmeGimme_with_emotion.vmd'];
    const cameraFiles = [ 'models/mmd/cameras/GimmexGimme.vmd' ];
    const audioFile = 'models/mmd/audios/GimmexGimme.m4a';
    const audioParams = { delayTime: 6 * 1 / 30 };

    helper = new MMDAnimationHelper();

    const loader = new MMDLoader();

    loader.loadWithAnimation( modelFile, vmdFiles, function ( mmd ) {

        mesh = mmd.mesh;
        mesh.castShadow = true;
        mesh.receiveShadow = api["self shadow"];

        helper.add( mesh, {
            animation: mmd.animation,
            physics: true
        } );

        loader.loadAnimation( cameraFiles, camera, function ( cameraAnimation ) {

            helper.add( camera, {
                animation: cameraAnimation
            } );

            new THREE.AudioLoader().load( audioFile, function ( buffer ) {

                const audio = new THREE.Audio( listener ).setBuffer( buffer );

                helper.add( audio );
                scene.add( mesh );

                ready = true;

            }, onProgress, null );

        }, onProgress, null );
        
        ikHelper = helper.objects.get( mesh ).ikSolver.createHelper();
        ikHelper.visible = false;
        scene.add( ikHelper );

        physicsHelper = helper.objects.get( mesh ).physics.createHelper();
        physicsHelper.visible = false;
        scene.add( physicsHelper );

        initGui();

    }, onProgress, null );

    //

    window.addEventListener( 'resize', onWindowResize );

    function initGui() {

        const gui = new GUI();
        gui.add( api, 'play/pause' ).onChange( function (state) {
            isPlaying = state
            helper.enable( 'animation', state );
            helper.enable( 'cameraAnimation', state );
            if(helper.audio.isPlaying) {
                helper.audio.pause()
            }
        } );
        gui.add( api, 'music' ).onChange( function (state) {
            if(state) {
                helper.audio.setVolume(1.0);
            }else{
                helper.audio.setVolume(0.0);
            }
        } );

        gui.add( api, 'ground shadow' ).onChange( function (state) {
            ground.receiveShadow = state;
        } );
        gui.addColor( api, 'ground color' ).onChange( handleColorChange( ground.material.color));
        gui.addColor( api, 'background color' ).onChange( handleColorChange( scene.background));
        gui.addColor( api, 'fog color' ).onChange( handleColorChange( scene.fog.color ));
        gui.add( api, 'self shadow' ).onChange( function (state) {
            mesh.receiveShadow = state;
        } );
        guiLight(gui);
        guiDebug(gui);
    }

    function guiLight( gui) {
        const folder = gui.addFolder( 'Light' );

        folder.addColor( api, 'Directional' ).onChange( handleColorChange( dirLight.color, true ) );
        folder.addColor( api, 'Hemisphere sky' ).onChange( handleColorChange( hemiLight.color, true ) );
        folder.addColor( api, 'Hemisphere ground' ).onChange( handleColorChange( hemiLight.groundColor, true ) );
    }
    function guiDebug(gui) {
        const folder = gui.addFolder( 'Debug' );

        folder.add( api, 'show outline' ).onChange( function (state) {
            effect.enabled = state;
        } );
        folder.add( api, 'show IK bones' ).onChange( function (state) {
            ikHelper.visible = state;
        } );
        folder.add( api, 'show rigid bodies' ).onChange( function (state) {
            if ( physicsHelper !== undefined ) physicsHelper.visible = state;
        } );
    }

}

function onWindowResize() {

    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();

    effect.setSize( window.innerWidth, window.innerHeight );

}

//

function animate() {

    requestAnimationFrame( animate );

    stats.begin();
    render();
    stats.end();
}

function render() {
    let delta = clock.getDelta()
    if(ready){
        if (isPlaying ) {

            helper.update( delta );

        }else{
            helper.objects.get(mesh).physics.update( delta );
        }
    }
    effect.render( scene, camera );

}