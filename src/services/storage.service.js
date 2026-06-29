const imagekit = require("../config/imagekit");

async function uploadEvidence(fileBuffer, fileName) {
    const response = await imagekit.upload({
        file: fileBuffer,
        fileName,
        folder: "/echallan/evidence",
    });

    return response;
}

module.exports = {
    uploadEvidence,
};