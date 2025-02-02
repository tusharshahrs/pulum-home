import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import * as awsx from "@pulumi/awsx";
import * as aws from "@pulumi/aws";
import { eksStack, eks_cluster_name,kubeconfig,k8sProvider,projectName,stackName, } from "./common";


const mywaternamespace = new k8s.core.v1.Namespace("water-Namespace", {
    apiVersion: "v1",
    kind: "Namespace",
    metadata: {
        name: "water-ns",
    },
}, { provider: k8sProvider });

/*const nginxserver = new k8s.helm.v3.Chart("nginxchart",  {
    version: "8.5.4",
    namespace: mywaternamespace.metadata.name,
    chart: "nginx",
    fetchOpts: {
        repo: "https://charts.bitnami.com/bitnami",
    },
}, { provider: k8sProvider });
*/

const nginxIngress = new k8s.helm.v3.Chart(`ingresshelm`, {
    fetchOpts: {
        repo: "https://kubernetes.github.io/ingress-nginx"
    },
    chart: "ingress-nginx",
    version: "3.31.0",
    namespace: mywaternamespace.metadata.name,
    values: {
        controller: {
            replicaCount: 1,
            annotations: {"kubernetes.io/ingress.class":"alb"},
        },
        defaultBackend: {
            enabled: true
        },
    },
}, {provider: k8sProvider });

 // Frontend Ingress
const mywater_ingress = new k8s.networking.v1beta1.Ingress(    
//const mywater_ingress = new k8s.extensions.v1beta1.Ingress(
    `water-ingress`,
    {
      metadata: {
        namespace: mywaternamespace.metadata.name,
        name: "water-ingress",
        annotations: {
          "kubernetes.io/ingress.class": "alb",
          "alb.ingress.kubernetes.io/scheme": "internet-facing",
          "alb.ingress.kubernetes.io/healthcheck-path": "/chains/main/blocks/head/header",
          "alb.ingress.kubernetes.io/healthcheck-port": "8732",
          "ingress.kubernetes.io/force-ssl-redirect": "true",
          "alb.ingress.kubernetes.io/listen-ports": '[{"HTTP": 80}, {"HTTPS":443}]',
          "alb.ingress.kubernetes.io/actions.ssl-redirect": '{"Type": "redirect", "RedirectConfig": { "Protocol": "HTTPS", "Port": "443", "StatusCode": "HTTP_301"}}',
          "alb.ingress.kubernetes.io/load-balancer-attributes": "idle_timeout.timeout_seconds=180",
          "pulumi.com/skipAwait": "true"
        },
        labels: { app: "shaht-node" }
      },
      spec: {
        rules: [
          {
            host: "water-pulumi.tusharshah.com",
            http: {
              paths: [
                {
                  path: "/*",
                  backend: { serviceName: "ssl-redirect", servicePort: "use-annotation" }
                },
                {
                  path: "/*",
                  backend: { serviceName: "frontend", servicePort: "http" }
                },
                {
                  path: "/api",
                  backend: {
                    serviceName: "ipfs",
                    servicePort: "gateway"
                  },
                },

              ]
            }
          },
          {
            host: "water-pulumi-api.tusharshah.com",
            http: {
              paths: [
                {
                  path: "/*",
                  backend: { serviceName: "ssl-redirect", servicePort: "use-annotation" }
                },
                {
                  path: "/*",
                  backend: { serviceName: "backend", servicePort: "http" }
                },

              ]
            }
          }
        ],
        tls: [{
          secretName: "watershaht-tls",
          hosts: ["water-pulumi.tusharshah.com","water-pulumi-api.tusharshah.com"]
      }],
      }
    },
    { provider: k8sProvider }
  );

  // Route 53
  function getDomainAndSubdomain(domain: string) {
    const parts = domain.split('.');
    if (parts.length < 2) {
      throw new Error(`No TLD found on ${domain}`);
    }
    // No subdomain, e.g. awesome-website.com.
    if (parts.length === 2) {
      return { fullurl: domain, subdomain: '', parentDomain: domain };
    }
  
    const subdomain = parts[0];
    parts.shift(); // Drop first element.
    return {
      fullurl: domain,
      subdomain,
      // Trailing "." to canonicalize domain.
      parentDomain: parts.join('.') + '.'
    };
  }

function createAliasRecord(targetDomain: string, albUrl: string): aws.route53.Record {
    const targetDomainObj = getDomainAndSubdomain(targetDomain);
  
    const albUrlObj = getDomainAndSubdomain(albUrl);
    console.log('albUrlObj', albUrlObj);
    const hostedZoneIdALB = aws.elb.getHostedZoneId().then(hostedZoneIdALB => hostedZoneIdALB.id);
  
     const targetZoneID = aws.route53.getZone({
      name: "tusharshah.com",
      }).then(targetZoneID => targetZoneID.zoneId)
  
    return new aws.route53.Record(targetDomain, {
      name: targetDomainObj.subdomain,
      zoneId: targetZoneID,
      type: 'A',
      aliases: [
        {
          name: albUrlObj.fullurl,
          zoneId: hostedZoneIdALB,
          evaluateTargetHealth: false
        }
      ]
    });
  }

  // Exported this to view it.
  export const water_ingress_1 = mywater_ingress.status.loadBalancer.ingress[0].hostname;
  // This ends up being something along the lines of:  water_ingress_1: "a6c7c878c56224f388aa5680b8bbc903-759956113.us-east-2.elb.amazonaws.com"

 // Commented this code out because we are creating a resource within an apply.  We don't want to do this due to 
 // https://www.pulumi.com/docs/intro/concepts/inputs-outputs/#apply (Check the Note section)
 /*const aRecords = mywater_ingress.status.apply((s) => {
    createAliasRecord('water-pulumi.tusharshah.com', s.loadBalancer.ingress[0].hostname)
    createAliasRecord('water-pulumi-api.tusharshah.com', s.loadBalancer.ingress[0].hostname)
    }
  );
*/

// Changed the albUrl type from: string to:  k8s.networking.v1beta1.Ingress
function createAliasRecord2(targetDomain: string, albUrl: k8s.networking.v1beta1.Ingress): aws.route53.Record {
  const targetDomainObj = getDomainAndSubdomain(targetDomain);

  // Passing in the albUrl after applying the apply because it is of type:  k8s.networking.v1beta1.Ingress.
  const albUrlObj = albUrl.status.loadBalancer.ingress[0].hostname.apply(mylb => mylb);
  // Commented out this code below since we needed to use an apply to pass in a string
  //const albUrlObj = getDomainAndSubdomain(albUrl);

  console.log('albUrlObj', albUrlObj);
  const hostedZoneIdALB = aws.elb.getHostedZoneId().then(hostedZoneIdALB => hostedZoneIdALB.id);

   const targetZoneID = aws.route53.getZone({
    name: "tusharshah.com",
    }).then(targetZoneID => targetZoneID.zoneId)

  // Updated the name within the aliases block.
  return new aws.route53.Record(targetDomain, {
    name: targetDomainObj.subdomain,
    zoneId: targetZoneID,
    type: 'A',
    aliases: [
      {
        name: albUrlObj,
        zoneId: hostedZoneIdALB,
        evaluateTargetHealth: false
      }
    ]
  });
}

// Tested on 1st record.
const aRecords = createAliasRecord2('water-pulumi.tusharshah.com', mywater_ingress);
