const storageService = require("../services/storage.service");
const violationService = require("../services/violation.service");

exports.receiveViolation = async (req, res) => {

    try {

        const metadata = JSON.parse(req.body.metadata);

        const uploadResult = await storageService.uploadEvidence(
            req.files.image[0]
        );

        const violation = await violationService.createViolation({
            metadata,
            uploadResult
        });

        return res.json({
            success: true,
            violation
        });

    } catch (err) {

        console.error(err);

        return res.status(500).json({
            success: false,
            message: err.message
        });

    }

};