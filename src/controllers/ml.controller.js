exports.receiveViolation = async (req, res) => {

    console.log("Body:");
    console.log(req.body);

    console.log("Files:");
    console.log(req.files);

    return res.status(200).json({
        success: true,
        body: req.body,
        files: Object.keys(req.files || {})
    });

};