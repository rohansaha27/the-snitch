// The scripted "terrible week" shared by the simulator and the demo seed.
// [day (0 = Monday), local time, merchant, amount]
export const TERRIBLE_WEEK: [number, string, string, number][] = [
  [0, "08:10", "Starbucks", 7.65],
  [0, "12:30", "Chipotle", 14.85],
  [0, "23:40", "DoorDash", 31.2],
  [1, "08:05", "Starbucks", 7.65],
  [1, "13:00", "Taco Bell", 11.49],
  [1, "19:30", "DoorDash", 26.8],
  [2, "08:00", "Starbucks", 7.65],
  [2, "15:20", "Amazon", 89.99],
  [3, "00:45", "DoorDash", 47.12],
  [3, "08:10", "Starbucks", 7.65],
  [4, "22:15", "Rick's American Cafe", 38],
  [5, "01:30", "Rick's American Cafe", 44],
  [5, "02:10", "Uber", 23.4],
  [5, "14:00", "Amazon", 164.5],
  [6, "03:20", "DoorDash", 52.3],
];

export const DEMO_BUDGETS: Record<string, number> = {
  food: 60,
  coffee: 20,
  nightlife: 50,
  shopping: 100,
  transport: 40,
};
