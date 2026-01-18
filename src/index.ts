import config from "./config";
import { LoadBalancer } from "./loadBalancer";

const lb = new LoadBalancer(config);
lb.start();
