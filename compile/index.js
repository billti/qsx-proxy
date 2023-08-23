// Note: At the time of writing, the Azure Functions were running Node.js v16.18
// See <https://nodejs.org/docs/latest-v16.x/api/> for docs

// @ts-check

// For developing functions, see https://learn.microsoft.com/en-us/azure/azure-functions/functions-reference-node

const util = require('util')
const fs   = require('fs/promises');

const join =        require('path').join;
const tmpdir =      require('os').tmpdir;
const randomBytes = require('crypto').randomBytes;

const exec = util.promisify(require('child_process').execFile);

const binPath = join(__dirname, process.platform, process.arch);
const qat = join(binPath, "qat");

function getTempInputFilename() {
    return join(tmpdir(), `qsc-${randomBytes(16).toString('hex')}.ll`);   
}
function getTempOutputFilename() {
    return join(tmpdir(), `qsc-${randomBytes(16).toString('hex')}.bc`);   
}

/**
 * 
 * @param {import('@azure/functions').Context} context 
 * @param {import('@azure/functions').HttpRequest} req 
 * @returns 
 */
module.exports = async function (context, req) {
    if (req.method === "OPTIONS") {
        context.log("Received an OPTIONS request");
        context.res = {
            headers: {
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "POST",
                "Access-Control-Allow-Headers": "Content-Type, x-hardware-target",
            },
            status: 200,
            body: ""
        }
        return;
    }

    if (!req.body) {
        context.res = {status: 400, body: "No source code provided"};
        return;
    }
    context.log("Got a request with body length: " + req.bufferBody?.length);

    let target = "rigetti";
    if (req.get("x-hardware-target") === "quantinuum") {
        target = "quantinuum";
    }
    context.log("Setting hardware target to: " + target);
    
    const tmpInputFile = getTempInputFilename();
    const tmpOutputFile = getTempOutputFilename();
    const decompFile = join(binPath, (target === "rigetti" ? "decomp_b340.ll" : "decomp_7ee0.ll"));

    if (!req.bufferBody) return; // TODO: Return 400 - Bad Request
    await fs.writeFile(tmpInputFile, req.bufferBody);
    context.log("Input file written to: " + tmpInputFile);

    try {
        // Check the files exist as expected
        const inputStat = await fs.stat(tmpInputFile);
        context.log("Input file exists with size: " + inputStat.size);
        const decompStat = await fs.stat(decompFile);
        context.log("Decomp file exists with size: " + decompStat.size);

        const args = [
          "--apply", "--always-inline", "--no-disable-record-output-support",
          "--entry-point-attr", "entry_point",
          "--output", tmpOutputFile,
          tmpInputFile, decompFile
        ];
        context.log("Running QAT with args: " + args.join(", "));
        const response = await exec(qat, args);
        // const response = await exec(qat, ["--help"]);
        if (response.stderr) context.log("QAT stderr: " + response.stderr);
        context.log("QAT stdout: " + response.stdout);

        const bitcode = await fs.readFile(tmpOutputFile);
        // const bitcode = "testing";
        context.log("output bitcode size: " + bitcode.byteLength);

        /** @type {import('@azure/functions').HttpResponseSimple} */
        const res = {
            headers: {
                "Content-Type": "application/octet-stream"
            },
            body: bitcode,
        }
        context.res = res;
    } catch (err) {
        context.res = {
            status: 400,
            body: JSON.stringify(err)
        }
    }
    try {
        await fs.rm(tmpInputFile);
        await fs.rm(tmpOutputFile);
    } catch(e) {
        context.log("Failed to clean up temporary files: " + e.toString());
    }

    context.log("All done.");
}
