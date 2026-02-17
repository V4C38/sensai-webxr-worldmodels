# sensai-webxr-worldmodels

This repository contains everything you need to get started with worldmodels in WebXR.

[Demo GIF]

Worldmodels / Gaussian splats
- using .spz or .ply
- put into /public/splats
- reccomended to use WorldLabs Marble (-> download low / high as .ply)
- collision handling (download mesh and add)
- Pivot / positioning / scale

Worldmodels / Gaussian splats: SparkJS
- made by Worldlabs https://sparkjs.dev/
- simple and performant rendering of gaussian splats

Worldmodels / Gaussian splats: Performance
- large splats can be hard on standalone (Quest / PICO) -> propose LOD system from SparkJS

IWSDK 
see https://elixrjs.io/

IWSDK: Interactions
[Demo GIF]
- Built in interactions like 1/2H grab and distance grab
IWSDK: Locomotion
[Demo GIF]
- we disabled the separate worker for locomotion for simplicity sake, if performance is lacking, you can enable it 

IWSDK: Spatial Editor
[UI Screenshot]
- disabled by default (how to add)
- why it can make sense to have, depending on your workflow (do you add splats at runtime or is the env prebuild/configured)

Testing
- see https://elixrjs.io/guides/08-build-deploy.html
- use npm run dev 

Deployment
- reccomended workflow is to deploy on cloudflare worker (free, see https://blog.cloudflare.com/workers-sites/)