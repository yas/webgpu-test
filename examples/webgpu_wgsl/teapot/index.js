init();
const vertexShaderWGSL = document.getElementById("vs").textContent;
const fragmentShaderWGSL = document.getElementById("fs").textContent;

async function init(glslang) {
    const gpu = navigator["gpu"];
    const adapter = await gpu.requestAdapter();
    const device = await adapter.requestDevice();

    const c = document.getElementById("c");
    c.width = window.innerWidth;
    c.height = window.innerHeight;

    const aspect = Math.abs(c.width / c.height);
    let projectionMatrix = mat4.create();
    mat4.perspective(projectionMatrix, 45, aspect, 0.1, 1000.0);

    const ctx = c.getContext("gpupresent")
    const swapChainFormat = "bgra8unorm";
    const swapChain = configureSwapChain(device, swapChainFormat, ctx);

    let vShaderModule = makeShaderModule_WGSL(device, vertexShaderWGSL);
    let fShaderModule = makeShaderModule_WGSL(device, fragmentShaderWGSL);

    let vertexBuffer;
    let normalBuffer;
    let coordBuffer;
    let indexBuffer;

    const uniformsBindGroupLayout = device.createBindGroupLayout({
        entries: [{
            binding: 0,
            visibility: GPUShaderStage.VERTEX,
            type: "uniform-buffer"
        }, {
            // Sampler
            binding: 1,
            visibility: GPUShaderStage.FRAGMENT,
            type: "sampler"
        }, {
            // Texture view
            binding: 2,
            visibility: GPUShaderStage.FRAGMENT,
            type: "sampled-texture"
        }, {
            // Lighting
            binding: 3,
            visibility: GPUShaderStage.FRAGMENT,
            type: "uniform-buffer"
        }]
    });
    const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [uniformsBindGroupLayout] });
    const pipeline = device.createRenderPipeline({
        layout: pipelineLayout,
        vertexStage: {
            module: vShaderModule,
            entryPoint: "main"
        },
        fragmentStage: {
            module: fShaderModule,
            entryPoint: "main"
        },
        vertexState: {
            vertexBuffers: [
                {
                    arrayStride: 3 * 4,
                    attributes: [
                        {
                            // position
                            shaderLocation: 0,
                            offset: 0,
                            format: "float3"
                        }
                    ]
                },
                {
                    arrayStride: 3 * 4,
                    attributes: [
                        {
                            // normal
                            shaderLocation: 1,
                            offset: 0,
                            format: "float3"
                        }
                    ]
                },
                {
                    arrayStride: 2 * 4,
                    attributes: [
                        {
                            // textureCoord
                            shaderLocation: 2,
                            offset:  0,
                            format: "float2"
                        }
                    ]
                }
            ]
        },
        colorStates: [
            {
                format: swapChainFormat,
                alphaBlend: {
                    srcFactor: "src-alpha",
                    dstFactor: "one-minus-src-alpha",
                    operation: "add"
                }
            }
        ],
        primitiveTopology: "triangle-list",
        rasterizationState: {
            frontFace : "ccw",
            cullMode : "none"
        },
        depthStencilState: {
            depthWriteEnabled: true,
            depthCompare: "less",
            format: "depth24plus-stencil8",
        }
    });

    const uniformBufferSize = 4 * 16; // 4x4 matrix
    const uniformBuffer = device.createBuffer({
        size: uniformBufferSize,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const sampler = device.createSampler({
        magFilter: "linear",
        minFilter: "linear",
        addressModeU: "repeat",
        addressModeV: "repeat",
    });

    // copy from: https://github.com/gpjt/webgl-lessons/blob/master/lesson14/arroway.de_metal%2Bstructure%2B06_d100_flat.jpg
    const cubeTexture = await createTextureFromImage(device, "../../../assets/textures/arroway.de_metal+structure+06_d100_flat.jpg", GPUTextureUsage.SAMPLED);
    
    const uniformLightBufferSize = 4 * 3; // 4 x vec3
    const uniformLightBuffer = device.createBuffer({
        size: uniformLightBufferSize,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const uniformBindGroup = device.createBindGroup({
        layout: uniformsBindGroupLayout,
        entries: [{
            binding: 0,
            resource: {
                buffer: uniformBuffer,
            }, 
        }, {
            binding: 1,
            resource: sampler,
        }, {
            binding: 2,
            resource: cubeTexture.createView(),
        }, {
            binding: 3,
            resource: {
                buffer: uniformLightBuffer,
            } 
        }],
    });
    
    let rad = 0;
    function getTransformationMatrix() {
        rad += Math.PI * 1.0 / 180.0;
        let viewMatrix = mat4.create();
        mat4.translate(viewMatrix, viewMatrix, vec3.fromValues(0, 0, -35));
        let now = Date.now() / 1000;
        //mat4.rotate(viewMatrix, viewMatrix, 1, vec3.fromValues(Math.sin(now), Math.cos(now), 0));
        mat4.rotate(viewMatrix, viewMatrix, rad, [0, 1, 0]);

        let modelViewProjectionMatrix = mat4.create();
        mat4.multiply(modelViewProjectionMatrix, projectionMatrix, viewMatrix);

        return modelViewProjectionMatrix;
    }

    const depthTexture = device.createTexture({
        size: {
            width: c.width,
            height: c.height,
            depth: 1
        },
        format: "depth24plus-stencil8",
        usage: GPUTextureUsage.OUTPUT_ATTACHMENT
    });

    let render =  function () {

        const commandEncoder = device.createCommandEncoder();
        const { uploadBuffer: uploadBuffer1 } = updateBufferData(device, uniformBuffer, 0, getTransformationMatrix(), commandEncoder);
        const { uploadBuffer: uploadBuffer2 } = updateBufferData(device, uniformLightBuffer, 0, new Float32Array([100.0, 0.0, 100.0]), commandEncoder);
        const textureView = swapChain.getCurrentTexture().createView();
        const renderPassDescriptor = {
            colorAttachments: [{
                attachment: textureView,
                loadValue: {r: 0, g: 0, b: 0, a: 0},
            }],
            depthStencilAttachment: {
                attachment: depthTexture.createView(),
                depthLoadValue: 1.0,
                depthStoreOp: "store",
                stencilLoadValue: 0,
                stencilStoreOp: "store",
            }
        };
        const passEncoder = commandEncoder.beginRenderPass(renderPassDescriptor);
        passEncoder.setPipeline(pipeline);
        passEncoder.setVertexBuffer(0, vertexBuffer);
        passEncoder.setVertexBuffer(1, normalBuffer);
        passEncoder.setVertexBuffer(2, coordBuffer);
        passEncoder.setIndexBuffer(indexBuffer, "uint32");
        passEncoder.setBindGroup(0, uniformBindGroup);
        passEncoder.drawIndexed(indexBuffer.pointNum, 1, 0, 0, 0);
        passEncoder.endPass();
        device.defaultQueue.submit([commandEncoder.finish()]);
        uploadBuffer1.destroy();
        uploadBuffer2.destroy();
        requestAnimationFrame(render);
    }

    // copy from: https://github.com/gpjt/webgl-lessons/blob/master/lesson14/Teapot.json
    $.getJSON("../../../assets/json/teapot.json", function (data) {
        vertexBuffer = makeVertexBuffer(device, new Float32Array(data.vertexPositions));
        normalBuffer = makeVertexBuffer(device, new Float32Array(data.vertexNormals));
        coordBuffer = makeVertexBuffer(device, new Float32Array(data.vertexTextureCoords));
        indexBuffer = makeIndexBuffer(device, new Uint32Array(data.indices));

        requestAnimationFrame(render)
    });
}

function configureSwapChain(device, swapChainFormat, context) {
    const swapChainDescriptor = {
        device: device,
        format: swapChainFormat
    };
    return context.configureSwapChain(swapChainDescriptor);
}

function makeShaderModule_WGSL(device, source) {
    let shaderModuleDescriptor = {
        code: source
    };
    let shaderModule = device.createShaderModule(shaderModuleDescriptor);
    return shaderModule;
}

function makeVertexBuffer(device, data) {
    const verticesBuffer = device.createBuffer({
        size: data.byteLength,
        usage: GPUBufferUsage.VERTEX,
        mappedAtCreation: true
    });
    new Float32Array(verticesBuffer.getMappedRange()).set(data);
    verticesBuffer.unmap();
    return verticesBuffer;
}

function makeIndexBuffer(device, data) {
    const indicesBuffer = device.createBuffer({
        size: data.byteLength,
        usage: GPUBufferUsage.INDEX,
        mappedAtCreation: true
    });
    new Uint32Array(indicesBuffer.getMappedRange()).set(data);
    indicesBuffer.pointNum = data.length;
    indicesBuffer.unmap();
    return indicesBuffer;
}

function updateBufferData(device, dst, dstOffset, src, commandEncoder) {
    const uploadBuffer = device.createBuffer({
        size: src.byteLength,
        usage: GPUBufferUsage.COPY_SRC,
        mappedAtCreation: true
    });

    new src.constructor(uploadBuffer.getMappedRange()).set(src);
    uploadBuffer.unmap();

    commandEncoder = commandEncoder || device.createCommandEncoder();
    commandEncoder.copyBufferToBuffer(uploadBuffer, 0, dst, dstOffset, src.byteLength);

    return { commandEncoder, uploadBuffer };
}

async function createTextureFromImage(device, src, usage) {
    const img = document.createElement("img");
    img.src = src;
    await img.decode();

    const imageCanvas = document.createElement("canvas");
    imageCanvas.width = img.width;
    imageCanvas.height = img.height;

    const imageCanvasContext = imageCanvas.getContext("2d");
    imageCanvasContext.translate(0, img.height);
    imageCanvasContext.scale(1, -1);
    imageCanvasContext.drawImage(img, 0, 0, img.width, img.height);
    const imageData = imageCanvasContext.getImageData(0, 0, img.width, img.height);

    let data = null;

    const bytesPerRow = Math.ceil(img.width * 4 / 256) * 256;
    if (bytesPerRow == img.width * 4) {
        data = imageData.data;
    } else {
        data = new Uint8Array(bytesPerRow * img.height);
        let imagePixelIndex = 0;
        for (let y = 0; y < img.height; ++y) {
            for (let x = 0; x < img.width; ++x) {
                let i = x * 4 + y * bytesPerRow;
                data[i] = imageData.data[imagePixelIndex];
                data[i + 1] = imageData.data[imagePixelIndex + 1];
                data[i + 2] = imageData.data[imagePixelIndex + 2];
                data[i + 3] = imageData.data[imagePixelIndex + 3];
                imagePixelIndex += 4;
            }
        }
    }

    const texture = device.createTexture({
        size: {
            width: img.width,
            height: img.height,
            depth: 1,
        },
        format: "rgba8unorm",
        usage: GPUTextureUsage.COPY_DST | usage,
    });

    const textureDataBuffer = device.createBuffer({
        size: data.byteLength,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
        mappedAtCreation: true
    });
    new Uint8Array(textureDataBuffer.getMappedRange()).set(data);
    textureDataBuffer.unmap();

    const commandEncoder = device.createCommandEncoder({});
    commandEncoder.copyBufferToTexture({
        buffer: textureDataBuffer,
        bytesPerRow,
    }, {
        texture: texture,
    }, {
        width: img.width,
        height: img.height,
        depth: 1,
    });

    device.defaultQueue.submit([commandEncoder.finish()]);
    textureDataBuffer.destroy();

    return texture;
}
