const express = require('express');
const multer = require('multer');
const grievanceController = require('../controllers/grievance.controller');
const { userAuth, authorize } = require('../middleware/userAuth');
const grievanceValidation = require('../middleware/grievanceValidation');

const router = express.Router();

const upload = multer({
	storage: multer.memoryStorage(),
	limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
	fileFilter: (req, file, cb) => {
		if (!file.mimetype.startsWith('image/')) {
			return cb(new Error('Only image uploads are allowed'), false);
		}
		cb(null, true);
	}
});

// Citizen endpoints
router.post('/grievances', userAuth, authorize('CITIZEN'), upload.single('evidence'), grievanceValidation, grievanceController.createGrievance);

router.get('/grievances/my', userAuth, authorize('CITIZEN'), grievanceController.getMyGrievances);

router.get('/grievances/:id', userAuth, authorize('CITIZEN'), grievanceController.getGrievanceById);

// Officer endpoints
router.get('/officer/grievances', userAuth, authorize('GRIEVANCE_OFFICER', 'ADMIN'), grievanceController.listForOfficer);

router.get('/officer/grievances/:id', userAuth, authorize('GRIEVANCE_OFFICER', 'ADMIN'), grievanceController.getForOfficer);

router.patch('/officer/grievances/:id/review', userAuth, authorize('GRIEVANCE_OFFICER', 'ADMIN'), grievanceController.startReview);

router.patch('/officer/grievances/:id/approve', userAuth, authorize('GRIEVANCE_OFFICER', 'ADMIN'), grievanceController.approve);

router.patch('/officer/grievances/:id/reject', userAuth, authorize('GRIEVANCE_OFFICER', 'ADMIN'), grievanceController.reject);

module.exports = router;
