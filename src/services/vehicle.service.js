exports.normalizePlate = (plate) => {

    if (!plate) return null;

    return plate
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, "");

};
const prisma = require("../config/prisma");

exports.findVehicleByPlate = async (plate) => {

    const normalizedPlate = exports.normalizePlate(plate);

    return await prisma.vehicle.findUnique({

        where: {
            registrationNumber: normalizedPlate
        },

        include: {
            owner: true
        }

    });

};
exports.findOwnerByVehicle = async (vehicleId) => {

    return await prisma.vehicle.findUnique({

        where: {
            id: vehicleId
        },

        include: {
            owner: true
        }

    });

};