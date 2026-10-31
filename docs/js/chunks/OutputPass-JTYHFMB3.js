import{a as u,b as _,c as T}from"./chunk-RB7XPCZA.js";import{D as l,G as p,W as g,k as a,ka as f,l as t,m as o,n,o as r,p as s,ua as C}from"./chunk-IMHF43EN.js";import{c as i}from"./chunk-KTQ2W6JX.js";var h,m=i(()=>{h={name:"OutputShader",uniforms:{tDiffuse:{value:null},toneMappingExposure:{value:1}},vertexShader:`
		precision highp float;

		uniform mat4 modelViewMatrix;
		uniform mat4 projectionMatrix;

		attribute vec3 position;
		attribute vec2 uv;

		varying vec2 vUv;

		void main() {

			vUv = uv;
			gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );

		}`,fragmentShader:`
	
		precision highp float;

		uniform sampler2D tDiffuse;

		#include <tonemapping_pars_fragment>
		#include <colorspace_pars_fragment>

		varying vec2 vUv;

		void main() {

			gl_FragColor = texture2D( tDiffuse, vUv );

			// tone mapping

			#ifdef LINEAR_TONE_MAPPING

				gl_FragColor.rgb = LinearToneMapping( gl_FragColor.rgb );

			#elif defined( REINHARD_TONE_MAPPING )

				gl_FragColor.rgb = ReinhardToneMapping( gl_FragColor.rgb );

			#elif defined( CINEON_TONE_MAPPING )

				gl_FragColor.rgb = CineonToneMapping( gl_FragColor.rgb );

			#elif defined( ACES_FILMIC_TONE_MAPPING )

				gl_FragColor.rgb = ACESFilmicToneMapping( gl_FragColor.rgb );

			#elif defined( AGX_TONE_MAPPING )

				gl_FragColor.rgb = AgXToneMapping( gl_FragColor.rgb );

			#elif defined( NEUTRAL_TONE_MAPPING )

				gl_FragColor.rgb = NeutralToneMapping( gl_FragColor.rgb );

			#endif

			// color space

			#ifdef SRGB_TRANSFER

				gl_FragColor = sRGBTransferOETF( gl_FragColor );

			#endif

		}`}});var d,c=i(()=>{C();T();m();d=class extends u{constructor(){super();let e=h;this.uniforms=g.clone(e.uniforms),this.material=new f({name:e.name,uniforms:this.uniforms,vertexShader:e.vertexShader,fragmentShader:e.fragmentShader}),this.fsQuad=new _(this.material),this._outputColorSpace=null,this._toneMapping=null}render(e,M,N){this.uniforms.tDiffuse.value=N.texture,this.uniforms.toneMappingExposure.value=e.toneMappingExposure,(this._outputColorSpace!==e.outputColorSpace||this._toneMapping!==e.toneMapping)&&(this._outputColorSpace=e.outputColorSpace,this._toneMapping=e.toneMapping,this.material.defines={},p.getTransfer(this._outputColorSpace)===l&&(this.material.defines.SRGB_TRANSFER=""),this._toneMapping===a?this.material.defines.LINEAR_TONE_MAPPING="":this._toneMapping===t?this.material.defines.REINHARD_TONE_MAPPING="":this._toneMapping===o?this.material.defines.CINEON_TONE_MAPPING="":this._toneMapping===n?this.material.defines.ACES_FILMIC_TONE_MAPPING="":this._toneMapping===r?this.material.defines.AGX_TONE_MAPPING="":this._toneMapping===s&&(this.material.defines.NEUTRAL_TONE_MAPPING=""),this.material.needsUpdate=!0),this.renderToScreen===!0?(e.setRenderTarget(null),this.fsQuad.render(e)):(e.setRenderTarget(M),this.clear&&e.clear(e.autoClearColor,e.autoClearDepth,e.autoClearStencil),this.fsQuad.render(e))}dispose(){this.material.dispose(),this.fsQuad.dispose()}}});c();export{d as OutputPass};
