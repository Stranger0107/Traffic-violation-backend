const imagekit = require("../config/imagekit");

exports.uploadEvidence = async (file) => {

    const response = await imagekit.upload({
        file: file.buffer,
        fileName: `${Date.now()}-${file.originalname}`,
        folder: "/echallan/evidence"
    });

    return response;
};