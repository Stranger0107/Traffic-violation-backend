exports.receiveViolation = async (req, res) => {

    return res.status(200).json({
        success: true,
        message: "ML endpoint working"
    });

};