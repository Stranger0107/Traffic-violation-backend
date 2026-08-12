const grievanceService = require('../services/grievance.service');

exports.createGrievance = async (req, res) => {
	try {
		const citizenId = req.user.id;
		const { challanId, reason, description } = req.body;
		const file = req.file;

		const grievance = await grievanceService.createGrievance({ citizenId, challanId, reason, description, file });
		return res.status(201).json({ success: true, grievance });
	} catch (err) {
		console.error(err);
		if (err.code === 'NOT_FOUND') return res.status(404).json({ success: false, message: err.message });
		if (err.code === 'FORBIDDEN') return res.status(403).json({ success: false, message: err.message });
		if (err.code === 'CONFLICT') return res.status(409).json({ success: false, message: err.message });
		if (err.code === 'TOO_MANY') return res.status(429).json({ success: false, message: err.message });
		return res.status(500).json({ success: false, message: err.message });
	}
};

exports.getMyGrievances = async (req, res) => {
	try {
		const grievances = await grievanceService.getMyGrievances(req.user.id);
		return res.json({ success: true, grievances });
	} catch (err) {
		console.error(err);
		return res.status(500).json({ success: false, message: err.message });
	}
};

exports.getGrievanceById = async (req, res) => {
	try {
		const grievance = await grievanceService.getGrievanceByIdForCitizen(req.params.id, req.user.id);
		if (!grievance) return res.status(404).json({ success: false, message: 'Grievance not found' });
		return res.json({ success: true, grievance });
	} catch (err) {
		console.error(err);
		if (err.code === 'FORBIDDEN') return res.status(403).json({ success: false, message: err.message });
		return res.status(500).json({ success: false, message: err.message });
	}
};

// Officer controllers
exports.listForOfficer = async (req, res) => {
	try {
		const items = await grievanceService.listGrievancesForOfficer();
		return res.json({ success: true, grievances: items });
	} catch (err) {
		console.error(err);
		return res.status(500).json({ success: false, message: err.message });
	}
};

exports.getForOfficer = async (req, res) => {
	try {
		const g = await grievanceService.getGrievanceByIdForOfficer(req.params.id);
		if (!g) return res.status(404).json({ success: false, message: 'Grievance not found' });
		return res.json({ success: true, grievance: g });
	} catch (err) {
		console.error(err);
		return res.status(500).json({ success: false, message: err.message });
	}
};

exports.startReview = async (req, res) => {
	try {
		const updated = await grievanceService.startReview({ grievanceId: req.params.id, officerId: req.user.id });
		return res.json({ success: true, grievance: updated });
	} catch (err) {
		console.error(err);
		if (err.code === 'NOT_FOUND') return res.status(404).json({ success: false, message: err.message });
		if (err.code === 'INVALID_STATE') return res.status(400).json({ success: false, message: err.message });
		return res.status(500).json({ success: false, message: err.message });
	}
};

exports.approve = async (req, res) => {
	try {
		const officerNote = req.body.officerNote;
		await grievanceService.approveGrievance({ grievanceId: req.params.id, officerId: req.user.id, officerNote });
		return res.json({ success: true });
	} catch (err) {
		console.error(err);
		if (err.code === 'NOT_FOUND') return res.status(404).json({ success: false, message: err.message });
		if (err.code === 'INVALID_STATE') return res.status(400).json({ success: false, message: err.message });
		return res.status(500).json({ success: false, message: err.message });
	}
};

exports.reject = async (req, res) => {
	try {
		const officerNote = req.body.officerNote;
		const updated = await grievanceService.rejectGrievance({ grievanceId: req.params.id, officerId: req.user.id, officerNote });
		return res.json({ success: true, grievance: updated });
	} catch (err) {
		console.error(err);
		if (err.code === 'NOT_FOUND') return res.status(404).json({ success: false, message: err.message });
		if (err.code === 'INVALID_STATE') return res.status(400).json({ success: false, message: err.message });
		return res.status(500).json({ success: false, message: err.message });
	}
};
